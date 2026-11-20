module.exports = {
  apps: [
    {
      name: "checkin-app",
      cwd: "/root/checkin-app/server",
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: "3001"
      },
      error_file: "/root/checkin-app/logs/pm2-error.log",
      out_file: "/root/checkin-app/logs/pm2-out.log",
      time: true
    }
  ]
};
