module.exports = {
  apps: [
    {
      name: "secure-chat-client",
      cwd: __dirname,
      script: "npm",
      args: "run preview -- --host 0.0.0.0 --port 5173",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
