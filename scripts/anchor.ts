#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
import { connectDatabase, disconnectDatabase, getPrismaClient } from '../src/db';
import { AggregationService } from '../src/aggregate';
import { RegistryAdapterClient } from '../src/anchor/registry-adapter-client';
import { addDays, getDayUtc } from '../src/util';
import pino from 'pino';

const logger = pino({
  level: config.logging.level,
  prettyPrint: config.logging.pretty,
});

interface AnchorOptions {
  siteId?: string;
  day?: string;
  force?: boolean;
}

async function parseArgs(): Promise<AnchorOptions> {
  const args = process.argv.slice(2);
  const options: AnchorOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--site' && i + 1 < args.length) {
      options.siteId = args[i + 1];
      i++;
    } else if (arg === '--day' && i + 1 < args.length) {
      options.day = args[i + 1];
      i++;
    } else if (arg === '--force') {
      options.force = true;
    }
  }
  
  return options;
}

async function anchorDigests(options: AnchorOptions): Promise<void> {
  const prisma = getPrismaClient();
  const aggregationService = new AggregationService();
  const anchorClient = new RegistryAdapterClient();
  
  // Parse date
  const targetDay = options.day ? new Date(options.day) : addDays(new Date(), -1);
  const dayUtc = getDayUtc(targetDay);
  
  // Get sites to process
  const siteIds = options.siteId ? [options.siteId] : config.siteIds;
  
  logger.info(`Anchoring digests for ${dayUtc}`);
  logger.info(`Sites: ${siteIds.join(', ')}`);
  
  for (const siteId of siteIds) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      logger.warn(`Site not found: ${siteId}`);
      continue;
    }
    
    logger.info(`Processing site: ${siteId} (${site.name})`);
    
    try {
      // Get digest
      const digest = await aggregationService.getDailyDigest(siteId, targetDay);
      if (!digest) {
        logger.warn(`No digest found for site ${siteId} on ${dayUtc}`);
        continue;
      }
      
      // Check if already anchored
      if (digest.anchorTxHash && !options.force) {
        logger.info(`Digest already anchored: ${digest.anchorTxHash}`);
        continue;
      }
      
      // Anchor the digest
      logger.info(`Anchoring digest for ${siteId}...`);
      const anchorResult = await anchorClient.anchorDigestWithRetry(
        siteId,
        dayUtc,
        digest.merkleRoot
      );
      
      if (anchorResult.success) {
        // Update digest with anchor information
        await aggregationService.updateDigestAnchor(
          siteId,
          dayUtc,
          anchorResult.adapterTxId,
          anchorResult.txHash
        );
        
        logger.info(`Digest anchored successfully: ${anchorResult.txHash}`);
        logger.info(`Adapter TX ID: ${anchorResult.adapterTxId}`);
        logger.info(`Block number: ${anchorResult.blockNumber}`);
      } else {
        logger.error(`Failed to anchor digest: ${anchorResult.error}`);
      }
      
    } catch (error) {
      logger.error(`Failed to anchor digest for site ${siteId}:`, error);
    }
  }
}

async function main(): Promise<void> {
  try {
    logger.info('Starting anchor process...');
    
    // Parse command line arguments
    const options = await parseArgs();
    
    // Connect to database
    await connectDatabase();
    
    // Run anchoring
    await anchorDigests(options);
    
    logger.info('Anchor process completed successfully');
    
  } catch (error) {
    logger.error('Anchor process failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
