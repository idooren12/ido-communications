import 'dotenv/config';
import { createApp } from './app';
import { prisma } from './lib/prisma';

const PORT = Number(process.env.PORT) || 3001;

const server = createApp().listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Don't hang forever on open keep-alive connections.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
