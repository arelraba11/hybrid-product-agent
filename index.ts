import concurrently from 'concurrently';

concurrently([
   {
      name: 'server',
      command: 'bun run dev',
      cwd: 'packages/server',
      prefixColor: 'cyan',
   },
   {
      name: 'client',
      command: 'bun run dev',
      cwd: 'packages/client',
      prefixColor: 'green',
   },
   {
      name: 'python',
      command: 'python3 -m uvicorn server:app --host 0.0.0.0 --port 8000',
      cwd: 'python-service',
      prefixColor: 'magenta',
   },
]);
