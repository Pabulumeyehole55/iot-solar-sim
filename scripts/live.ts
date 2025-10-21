#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
import { connectDatabase, disconnectDatabase, getPrismaClient } from '../src/db';
import { TelemetryGenerator } from '../src/ingest/telemetry-generator';
import { AggregationService } from '../src/aggregate';
import { DigestGenerator } from '../src/aggregate/digest-generator';
import { RegistryAdapterClient } from '../src/anchor/registry-adapter-client';
import { addMinutes, formatUtc } from '../src/util';
import pino from 'pino';

const logger = pino({
  level: config.logging.level,
  prettyPrint: config.logging.pretty,
});

interface LiveOptions {
  siteId?: string;
  interval?: number;
  duration?: number;
}

async function parseArgs(): Promise<LiveOptions> {
  const args = process.argv.slice(2);
  const options: LiveOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--site' && i + 1 < args.length) {
      options.siteId = args[i + 1];
      i++;
    } else if (arg === '--interval' && i + 1 < args.length) {
      options.interval = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--duration' && i + 1 < args.length) {
      options.duration = parseInt(args[i + 1]);
      i++;
    }
  }
  
  return options;
}

async function runLiveSimulation(options: LiveOptions): Promise<void> {
  const prisma = getPrismaClient();
  const aggregationService = new AggregationService();
  const digestGenerator = new DigestGenerator();
  const anchorClient = new RegistryAdapterClient();
  
  const intervalSeconds = options.interval || config.intervalSeconds;
  const durationMinutes = options.duration || 60; // Default 1 hour
  const siteIds = options.siteId ? [options.siteId] : config.siteIds;
  
  logger.info(`Starting live simulation for ${durationMinutes} minutes`);
  logger.info(`Interval: ${intervalSeconds} seconds`);
  logger.info(`Sites: ${siteIds.join(', ')}`);
  
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  
  // Generate initial data for today
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  for (const siteId of siteIds) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      logger.warn(`Site not found: ${siteId}`);
      continue;
    }
    
    logger.info(`Generating initial data for site: ${siteId} (${site.name})`);
    
    try {
      const telemetryGenerator = new TelemetryGenerator(site as any, config.simSeed);
      
      // Generate telemetry from start of day to now
      const telemetry = await telemetryGenerator.generateRangeTelemetry(
        today,
        new Date(),
        intervalSeconds / 60 // Convert to minutes
      );
      
      logger.info(`Generated ${telemetry.length} initial telemetry records for ${siteId}`);
      
    } catch (error) {
      logger.error(`Failed to generate initial data for site ${siteId}:`, error);
    }
  }
  
  // Live simulation loop
  let currentTime = new Date();
  let iteration = 0;
  
  while (currentTime < endTime) {
    iteration++;
    logger.info(`Live simulation iteration ${iteration} at ${formatUtc(currentTime)}`);
    
    for (const siteId of siteIds) {
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        continue;
      }
      
      try {
        const telemetryGenerator = new TelemetryGenerator(site as any, config.simSeed);
        
        // Generate single telemetry point
        const telemetry = await telemetryGenerator.generateTelemetry({
          siteId,
          startDate: currentTime,
          endDate: addMinutes(currentTime, intervalSeconds / 60),
          intervalMinutes: intervalSeconds / 60,
        });
        
        // Store telemetry
        await telemetryGenerator.storeTelemetry(telemetry);
        
        const latest = telemetry[0];
        logger.info(`${siteId}: ${latest.acPowerKw} kW, ${latest.acEnergyKwh} kWh, ${latest.status}`);
        
        // Generate digest at end of day
        const isEndOfDay = currentTime.getUTCHours() === 23 && currentTime.getUTCMinutes() >= 55;
        if (isEndOfDay) {
          logger.info(`Generating end-of-day digest for ${siteId}`);
          
          // Generate hourly summaries
          await aggregationService.generateHourlySummaries(siteId, currentTime);
          
          // Generate daily digest
          const digest = await digestGenerator.generateAndStoreDigest(
            siteId,
            currentTime,
            site as any,
            intervalSeconds / 60
          );
          
          logger.info(`Daily digest: ${digest.energyKwh} kWh, ${digest.avoidedTco2e} tCO2e avoided`);
          
          // Anchor digest if enabled
          if (config.anchorEnabled) {
            const anchorResult = await anchorClient.anchorDigestWithRetry(
              siteId,
              getDayUtc(currentTime),
              digest.merkleRoot
            );
            
            if (anchorResult.success) {
              await aggregationService.updateDigestAnchor(
                siteId,
                getDayUtc(currentTime),
                anchorResult.adapterTxId,
                anchorResult.txHash
              );
              logger.info(`Digest anchored: ${anchorResult.txHash}`);
            }
          }
        }
        
      } catch (error) {
        logger.error(`Failed to process live data for site ${siteId}:`, error);
      }
    }
    
    // Wait for next interval
    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    currentTime = new Date();
  }
  
  logger.info('Live simulation completed');
}

async function main(): Promise<void> {
  try {
    logger.info('Starting live simulation...');
    
    // Parse command line arguments
    const options = await parseArgs();
    
    // Connect to database
    await connectDatabase();
    
    // Run live simulation
    await runLiveSimulation(options);
    
    logger.info('Live simulation completed successfully');
    
  } catch (error) {
    logger.error('Live simulation failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
