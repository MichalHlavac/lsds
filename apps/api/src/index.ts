import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`LSDS API listening on http://localhost:${info.port}`);
});
