import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`api listening on :${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
