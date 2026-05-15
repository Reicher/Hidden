module.exports = {
  apps: [
    {
      name: "hidden",
      script: "npm",
      args: "start",
      env: {
        HOST: "127.0.0.1",
        PORT: "3000",
        ALLOWED_ORIGINS: [
          "https://hidden-game.duckdns.org",
          "https://robin-reicher.itch.io",
          "https://html-classic.itch.zone",
        ].join(","),
        // DEBUG_VIEW_TOKEN is intentionally NOT set here — set it in the
        // shell environment or in a local .env before running pm2 start,
        // to avoid committing secrets to git.
      },
    },
  ],
};
