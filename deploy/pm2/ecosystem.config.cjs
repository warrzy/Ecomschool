// ECOM-SCHOOL — préproduction
// Usage : pm2 start deploy/pm2/ecosystem.config.cjs --only ecomschool-preprod
//         pm2 reload ecomschool-preprod
// Ne pas utiliser ce fichier pour les autres applications (wendyam-finance...).

module.exports = {
  apps: [
    {
      name: "ecomschool-preprod",
      cwd: "/var/www/ecomschool-preprod",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001 -H 127.0.0.1",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1500M",
      env: {
        NODE_ENV: "production",
      },
      // Logs PM2 : /home/deploy/.pm2/logs/ecomschool-preprod-*.log
      out_file: "/var/log/ecomschool/preprod-out.log",
      error_file: "/var/log/ecomschool/preprod-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
