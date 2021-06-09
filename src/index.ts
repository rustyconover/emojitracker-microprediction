// What this code does is download the latest load information and publishes to microprediction.org
import { MicroWriter, MicroWriterConfig } from 'microprediction'
import { emoji_write_keys } from './write-keys'
import _ from 'lodash'
import { ScheduledHandler } from 'aws-lambda'
import S3 from 'aws-sdk/clients/s3'
import fetch from 'node-fetch'

type EmojiRecord = {
    name: string
    score: number
}

async function getEmojis(): Promise<EmojiRecord[]> {
    const result = await fetch('https://api.emojitracker.com/v1/rankings', {
        headers: {
            accept: 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'en-US,en;q=0.9',
            'sec-ch-ua':
                '" Not;A Brand";v="99", "Google Chrome";v="91", "Chromium";v="91"',
            'sec-ch-ua-mobile': '?0',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
        },
        // @ts-ignore
        referrer: 'https://www.emojitracker.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: undefined,
        method: 'GET',
        mode: 'cors',
    })

    return await result.json()
}

async function writeOldEmojis(data: EmojiRecord[]) {
    const s3 = new S3({ region: 'us-east-1' })
    try {
        const content = JSON.stringify(
            data.map((v) => {
                return { name: v.name, score: v.score }
            })
        )
        await s3
            .putObject({
                Bucket: 'microprediction-lambda',
                Key: 'old-emoji.json',
                Body: content,
            })
            .promise()
    } catch (e) {
        console.error(`Failed to write: ${e}`)
        return undefined
    }
}

async function getOldEmojis(): Promise<[Date, EmojiRecord[]] | undefined> {
    const s3 = new S3({ region: 'us-east-1' })
    try {
        const result = await s3
            .getObject({
                Bucket: 'microprediction-lambda',
                Key: 'old-emoji.json',
            })
            .promise()
        if (result.LastModified && result.Body) {
            return [
                result.LastModified,
                JSON.parse(result.Body.toString('utf8')),
            ]
        }
        return undefined
    } catch {
        return undefined
    }
}

function prettyEmojiName(name: string) {
    return name.toLowerCase().replace(/ /g, '_')
}

async function calculateEmojiUsage() {
    const current = await getEmojis()
    const old = await getOldEmojis()

    const old_write = writeOldEmojis(current)

    if (old == null) {
        console.log('No emoji history saved, so ignoring')
        return
    }

    const now = new Date()

    const oldAge = now.getTime() - old[0].getTime()

    if (oldAge > 1000 * 90) {
        // If the old values are greater than 90 seconds ago
        // don't push in the current values, just resync on
        // the next call, this prevents doubling up counts.
        console.log('Emoji history was too old ${oldAge}, ignoring for now.')
        return
    }

    // Now calculate the score differences.
    const current_scores = new Map<string, number>(
        current.map((v) => {
            return [v.name, v.score]
        })
    )
    const old_scores = new Map<string, number>(
        old[1].map((v) => {
            return [v.name, v.score]
        })
    )

    const old_names = Array.from(old_scores.keys())
    const current_names = Array.from(current_scores.keys())

    const changes = new Map<string, number>()

    for (const name of current_names.filter((x) => old_names.includes(x))) {
        const old_score = old_scores.get(name) as number
        const current_score = current_scores.get(name) as number

        const diff = current_score - old_score

        changes.set(name, diff)
    }

    const writes = []

    for (const [raw_name, change] of _.sortBy(
        Array.from(changes.entries()),
        (v) => v[1]
    ).reverse()) {
        const name = prettyEmojiName(raw_name)
        if (emoji_write_keys[name] != null) {
            let config = await MicroWriterConfig.create({
                write_key: emoji_write_keys[name],
            })
            const writer = new MicroWriter(config)
            console.log('Writing', name, change)
            writes.push(writer.set(`emojitracker-twitter-${name}.json`, change))
        } else {
            continue
            // Skip over emoji that don't have a dedicated write key.
            //      console.log(`'${name}': '${keys[key_index++]}',`);
        }
    }
    await Promise.all([...writes, old_write])
}

export const handler: ScheduledHandler<any> = async (event) => {
    await calculateEmojiUsage()
}
