// What this code does is download the latest load information and publishes to microprediction.org
import { MicroWriter, MicroWriterConfig, MicroReader } from "microprediction";
import { emoji_write_keys } from "./write-keys";
const bent = require("bent");

import * as _ from "lodash";
const getJSON = bent("json");
import { ScheduledHandler } from "aws-lambda";
import S3 from "aws-sdk/clients/s3";

type EmojiRecord = {
  name: string;
  score: number;
};

async function getEmojis(): Promise<EmojiRecord[]> {
  // The file is updated every five minutes.
  return getJSON("http://www.emojitracker.com/api/rankings");
}

async function writeOldEmojis(data: EmojiRecord[]) {
  const s3 = new S3({ region: "us-east-1" });
  try {
    const content = JSON.stringify(
      data.map((v) => {
        return { name: v.name, score: v.score };
      })
    );
    await s3
      .putObject({
        Bucket: "microprediction-lambda",
        Key: "old-emoji.json",
        Body: content,
      })
      .promise();
  } catch (e) {
    console.error(`Failed to write: ${e}`);
    return undefined;
  }
}

async function getOldEmojis(): Promise<EmojiRecord[] | undefined> {
  const s3 = new S3({ region: "us-east-1" });
  try {
    const result = await s3
      .getObject({
        Bucket: "microprediction-lambda",
        Key: "old-emoji.json",
      })
      .promise();
    if (result.Body) {
      return JSON.parse(result.Body.toString("utf8"));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function prettyEmojiName(name: string) {
  return name.toLowerCase().replace(/ /g, "_");
}

async function calculateEmojiUsage() {
  const current = await getEmojis();
  const old = await getOldEmojis();

  const old_write = writeOldEmojis(current);

  if (old == null) {
    console.log("No emoji history saved, so ignoring");
    return;
  }

  // Now calculate the score differences.
  const current_scores = new Map<string, number>(
    current.map((v) => {
      return [v.name, v.score];
    })
  );
  const old_scores = new Map<string, number>(
    old.map((v) => {
      return [v.name, v.score];
    })
  );

  const old_names = Array.from(old_scores.keys());
  const current_names = Array.from(current_scores.keys());

  const changes = new Map<string, number>();

  for (const name of current_names.filter((x) => old_names.includes(x))) {
    const old_score = old_scores.get(name) as number;
    const current_score = current_scores.get(name) as number;

    const diff = current_score - old_score;

    changes.set(name, diff);
  }

  const writes = [];

  for (const [raw_name, change] of _.sortBy(
    Array.from(changes.entries()),
    (v) => v[1]
  ).reverse()) {
    const name = prettyEmojiName(raw_name);
    if (emoji_write_keys[name] != null) {
      let config = await MicroWriterConfig.create({
        write_key: emoji_write_keys[name],
      });
      const writer = new MicroWriter(config);
      console.log("Writing", name, change);
      writes.push(writer.set(`emojitracker-twitter-${name}.json`, change));
    } else {
      // Skip over emoji that don't have a dedicated write key.
      //      console.log(`'${name}': '${keys[key_index++]}',`);
    }
  }
  await Promise.all([...writes, old_write]);
}

export const handler: ScheduledHandler<any> = async (event) => {
  console.log("Fetching data");
  await calculateEmojiUsage();
};
