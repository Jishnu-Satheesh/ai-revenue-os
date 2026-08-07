/** Trigger.dev configuration boundary. Worker code stays in this repository; Postgres stays authoritative. */
const triggerConfig = {
  project: process.env.TRIGGER_PROJECT_REF,
  dirs: ["./src/workflows"],
};

export default triggerConfig;
