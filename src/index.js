import "dotenv/config";
import app from "./server.js";
import { startWorker } from "./worker.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

startWorker();
