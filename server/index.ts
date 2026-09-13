import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app';
const port=Number(process.env.PORT || 4317);
const {app}=createApp(resolve(process.env.MARGIN_DATA_DIR || '.data'),{port});
app.listen(port,'127.0.0.1',()=>console.log(`Margin is ready at http://127.0.0.1:${port}. Open Settings there to connect your providers and pair Chrome.`));
