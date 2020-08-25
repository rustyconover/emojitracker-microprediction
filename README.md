# Import Emojitracker to Microprediction

This module is an example use of the [microprediction](https://www.npmjs.com/package/microprediction)
module to import data from [emojitracker.com](https://emojitracker.com) to the microprediction to
predict of many emojis will be used on Twitter between updates.

## Loaded Data

The data is sourced from:

`http://www.emojitracker.com/api/rankings`

## Implementation Details

There is a single Lambda function that is run as a scheduled
CloudWatch Event every minute pull new data. This function
is created using webpack to amalgamate the various imported modules.

It runs in about 2 seconds or less every minute.

The write keys are not included in this repo.
