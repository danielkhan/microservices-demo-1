/*
 * Copyright 2018 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const tracer = require("./tracing")("currencyservice");

const express = require("express");
const bodyParser = require("body-parser");

const path = require("path");
const grpc = require("grpc");
const pino = require("pino");
const axios = require("axios");

const PORT = process.env.PORT;

const supportedCurrencies = require("./data/supportedCurrencies.json");
const exchangerateAPI = "https://api.exchangeratesapi.io";

const logger = pino({
  name: "currencyservice-server",
  messageKey: "message",
  changeLevelName: "severity",
  useLevelLabels: true,
});

const app = express();
app.use(bodyParser.json());

/**
 * Helper function that gets currency data from a stored JSON file
 * Uses public data from European Central Bank
 */
function _getCurrencyData(callback) {
  const data = require("./data/currency_conversion.json");
  callback(data);
}

/**
 * Helper function that handles decimal/fractional carrying
 */
function _carry(amount) {
  const fractionSize = Math.pow(10, 9);
  amount.nanos += (amount.units % 1) * fractionSize;
  amount.units =
    Math.floor(amount.units) + Math.floor(amount.nanos / fractionSize);
  amount.nanos = amount.nanos % fractionSize;
  return amount;
}

/**
 * Converts between currencies
 */
async function convert(from, to_code) {
  logger.info("querying API");
  let url = "";

  // Slow down by a random value between 1000 and 2000ms when converting to GBP
  if (to_code === "GBP") {
    const delay = Math.floor(Math.random() * 2000) + 1000;
    logger.info(`Slowing down request by ${delay}`);
    url = `http://slowwly.robertomurray.co.uk/delay/${delay}/url/${exchangerateAPI}/latest?base=${from.currency_code}&symbols=${to_code}`;
  } else {
    url = `${exchangerateAPI}/latest?base=${from.currency_code}&symbols=${to_code}`;
  }

  // On purpose not promise all - but could be a showcase for
  // serial vs perallel
  const currencyAPIResult = await axios.get(url);

  const factor = currencyAPIResult.data.rates[to_code];

  // Convert: EUR --> to_currency
  const result = _carry({
    units: from.units * factor,
    nanos: from.nanos * factor,
  });

  result.units = Math.floor(result.units);
  result.nanos = Math.floor(result.nanos);
  result.currency_code = to_code;

  logger.info(`conversion request successful`);
  return result;
}

app.get("/_healthz", (req, res, next) => {
  res.send("SERVING");
});

/*
// Test payload for POST /convert:
{
    "from": {
        "currency_code": "USD",
        "units": 65,
        "nanos": 500000000
    },
    "to": "EUR"
}
*/
app.post("/convert", async (req, res, next) => {
  try {
    logger.info("received conversion request");
    const { from, to } = req.body;
    const result = await convert(from, to);
    return res.json(result);
  } catch (err) {
    logger.error(`conversion request failed: ${err}`);
  }
});

app.get("/supported", async (req, res, next) => {
  return res.json(supportedCurrencies);
});

app.listen(PORT, () => {
  logger.info(`Starting HTTP server on port ${PORT}...`);
});
