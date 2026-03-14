module.exports = {
  apps: [
    {
      name: "secure-chat-server",
      cwd: __dirname,
      script: "dist/index.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
