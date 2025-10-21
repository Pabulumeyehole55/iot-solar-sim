import { config } from './config';
import { connectDatabase, disconnectDatabase } from './db';
import { ApiServer } from './api/server';
import pino from 'pino';

// Create logger
const logger = pino({
  level: config.logging.level,
  prettyPrint: config.logging.pretty,
});

// Graceful shutdown handler
async function gracefulShutdown(server: ApiServer) {
  logger.info('Received shutdown signal, closing server...');
  
  try {
    await server.stop();
    await disconnectDatabase();
    logger.info('Server closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Main application
async function main() {
  try {
    logger.info('Starting IoT Solar Simulator...');
    
    // Connect to database
    await connectDatabase();
    
    // Create and start API server
    const server = new ApiServer();
    await server.initialize();
    
    // Start server
    await server.start();
    
    // Setup graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));
    
    logger.info('IoT Solar Simulator started successfully');
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}

export { main };
