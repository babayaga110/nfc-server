const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const { NFC } = require("nfc-pcsc");

// Express App Initialization
const app = express();
const port = 5000;

// Middlewares
app.use(cors({ origin: true }));
app.use(express.json());

// NFC Initialization
const nfc = new NFC();

// Global variable to store NFC reader instance
let currentReader = null;

/* ======================= NFC Events ======================= */
nfc.on("reader", (reader) => {
    logger.info(`${reader.reader.name} device attached`);
    currentReader = reader;

    // Event: Card detected
    reader.on("card", async (card) => {
        logger.info(`${reader.reader.name} card detected:`, card);
    });

    // Event: Card removed
    reader.on("card.off", (card) => {
        logger.info(`${reader.reader.name} card removed:`, card);
    });

    // Event: Reader error
    reader.on("error", (err) => {
        logger.error(`${reader.reader.name} an error occurred:`, err);
    });

    // Event: Reader disconnected
    reader.on("end", () => {
        logger.info(`${reader.reader.name} device removed`);
        currentReader = null;
    });
});


// Event: NFC initialization error
nfc.on("error", (err) => {
    logger.error("NFC initialization error:", err);
});

/* ======================= Express Routes ======================= */

// Route: Write data to NFC tag
app.post("/nfcWrite", async (req, res) => {
    try {
        const { ...data } = req.body;

        if (!data) {
            return res.status(400).send("Missing 'data' field in the request body.");
        }

        // Check if a reader is available
        if (!currentReader) {
            return res.status(500).send("No NFC reader connected.");
        }

        const dataString = JSON.stringify(data);
        logger.debug("Data to write to NFC tag:", dataString);

        if (Buffer.byteLength(dataString) > 180) {
            return res.status(400).send("Data exceeds the maximum size of 180 bytes.");
        }
        const blockSize = 4; // NFC block size

        // Convert the string into a Buffer with padding
        const buffer = Buffer.alloc(Math.ceil(dataString.length / blockSize) * blockSize, 0); // Pad to nearest multiple of blockSize
        buffer.write(dataString); // Write data into the buffer

        for (let i = 0; i < buffer.length / blockSize; i++) {
            const chunk = buffer.slice(i * blockSize, (i + 1) * blockSize);
            await currentReader.write(4 + i, chunk); // Write the chunk to the NFC tag
            console.debug(`Writing chunk ${i}: ${chunk.toString('utf-8')}`);
        }
        logger.info("Data successfully written to NFC tag");

        return res.status(200).send({
            message: "Data successfully written to NFC tag"
        })
    } catch (error) {
        logger.error("Error writing to NFC tag:", error);
        return res.status(500).send({
            error: `Error writing to NFC tag`
        });
    }
});

app.get("/nfcRead", async (req, res) => {
    try {
        if (!currentReader) {
            return res.status(500).send("No NFC reader connected.");
        }

        if (!currentReader.card) {
            return res.status(404).send("No card detected. Place a card on the reader.");
        }

        const blockSize = 4; // NFC block size
        let buffer = Buffer.alloc(0);

        let unfinished = true;
        let i = 0;
        do {
            try {
                const chunk = await currentReader.read(4 + i, blockSize);
                const chunkData = chunk.toString('utf-8').replace(/\0/g, ''); // Clean null bytes
                console.debug(`Read chunk ${i}: ${chunkData}`);
                buffer = Buffer.concat([buffer, Buffer.from(chunkData, 'utf-8')]);
                if (chunkData.length < blockSize) {
                    unfinished = false;
                }
                i++;
            } catch (error) {
                console.error(`Error reading chunk ${i}:`, error);
                unfinished = false;
            }
        } while (unfinished);
        // Reconstruct data string
        const dataString = buffer.toString('utf-8').replace(/\0/g, '').trim();
        console.debug(`Reconstructed data string: ${dataString}`);

        // Validate JSON format
        if (!dataString.startsWith('{') || !dataString.endsWith('}')) {
            throw new Error("Reconstructed data does not look like valid JSON.");
        }

        // Parse JSON
        const data = JSON.parse(dataString); // Throws error if invalid
        console.info("Successfully read and parsed data:", data);

        return res.status(200).send({ data });
    } catch (error) {
        logger.error("Error reading NFC tag:", error);
        res.status(500).send("Error reading NFC tag");
    }
});


/* ======================= Server Start ======================= */

app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});


exports.app = onRequest(app);