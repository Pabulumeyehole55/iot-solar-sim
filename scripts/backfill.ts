#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
import { connectDatabase, disconnectDatabase, getPrismaClient } from '../src/db';
import { TelemetryGenerator } from '../src/ingest/telemetry-generator';
import { AggregationService } from '../src/aggregate';
import { DigestGenerator } from '../src/aggregate/digest-generator';
import { addDays, getDayUtc } from '../src/util';
import pino from 'pino';

const logger = pino({
  level: config.logging.level,
  prettyPrint: config.logging.pretty,
});

interface BackfillOptions {
  siteId?: string;
  from?: string;
  to?: string;
  interval?: number;
  force?: boolean;
}

async function parseArgs(): Promise<BackfillOptions> {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--site' && i + 1 < args.length) {
      options.siteId = args[i + 1];
      i++;
    } else if (arg === '--from' && i + 1 < args.length) {
      options.from = args[i + 1];
      i++;
    } else if (arg === '--to' && i + 1 < args.length) {
      options.to = args[i + 1];
      i++;
    } else if (arg === '--interval' && i + 1 < args.length) {
      options.interval = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--force') {
      options.force = true;
    }
  }
  
  return options;
}

async function backfillData(options: BackfillOptions): Promise<void> {
  const prisma = getPrismaClient();
  const aggregationService = new AggregationService();
  const digestGenerator = new DigestGenerator();
  
  // Parse dates
  const fromDate = options.from ? new Date(options.from) : addDays(new Date(), -30);
  const toDate = options.to ? new Date(options.to) : new Date();
  const intervalMinutes = options.interval || 5;
  
  // Get sites to process
  const siteIds = options.siteId ? [options.siteId] : config.siteIds;
  
  logger.info(`Backfilling data from ${getDayUtc(fromDate)} to ${getDayUtc(toDate)}`);
  logger.info(`Interval: ${intervalMinutes} minutes`);
  logger.info(`Sites: ${siteIds.join(', ')}`);
  
  for (const siteId of siteIds) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      logger.warn(`Site not found: ${siteId}`);
      continue;
    }
    
    logger.info(`Processing site: ${siteId} (${site.name})`);
    
    let currentDate = new Date(fromDate);
    let processedDays = 0;
    let skippedDays = 0;
    
    while (currentDate <= toDate) {
      const dayUtc = getDayUtc(currentDate);
      
      try {
        // Check if data already exists
        const telemetryGenerator = new TelemetryGenerator(site as any, config.simSeed);
        const hasData = await telemetryGenerator.hasTelemetryForDay(siteId, currentDate);
        
        if (hasData && !options.force) {
          logger.debug(`Skipping ${dayUtc} - data already exists`);
          skippedDays++;
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          continue;
        }
        
        // Delete existing data if force mode
        if (hasData && options.force) {
          await telemetryGenerator.deleteTelemetryForDay(siteId, currentDate);
          logger.debug(`Deleted existing data for ${dayUtc}`);
        }
        
        // Generate telemetry
        const telemetry = await telemetryGenerator.generateDayTelemetry(currentDate, intervalMinutes);
        
        // Generate hourly summaries
        await aggregationService.generateHourlySummaries(siteId, currentDate);
        
        // Generate daily digest
        const digest = await digestGenerator.generateAndStoreDigest(
          siteId,
          currentDate,
          site as any,
          intervalMinutes
        );
        
        processedDays++;
        logger.info(`Processed ${dayUtc}: ${telemetry.length} records, ${digest.energyKwh} kWh, ${digest.avoidedTco2e} tCO2e`);
        
      } catch (error) {
        logger.error(`Failed to process ${dayUtc} for site ${siteId}:`, error);
      }
      
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    logger.info(`Completed site ${siteId}: ${processedDays} days processed, ${skippedDays} days skipped`);
  }
}

async function main(): Promise<void> {
  try {
    logger.info('Starting backfill process...');
    
    // Parse command line arguments
    const options = await parseArgs();
    
    // Connect to database
    await connectDatabase();
    
    // Run backfill
    await backfillData(options);
    
    logger.info('Backfill process completed successfully');
    
  } catch (error) {
    logger.error('Backfill process failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
