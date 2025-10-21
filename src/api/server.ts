import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { getPrismaClient, healthCheck } from '../db';
import { TelemetryGenerator } from '../ingest/telemetry-generator';
import { AggregationService } from '../aggregate';
import { DigestGenerator } from '../aggregate/digest-generator';
import { RegistryAdapterClient } from '../anchor/registry-adapter-client';
import { SiteConfig, siteConfigSchema } from '../config';
import { formatUtc, getDayUtc, addDays } from '../util';
import { registerDashboardRoutes } from '../ui/dashboard';

export interface ApiServerOptions {
  port?: number;
  host?: string;
}

export class ApiServer {
  private fastify: FastifyInstance;
  private prisma: PrismaClient;
  private telemetryGenerator?: TelemetryGenerator;
  private aggregationService: AggregationService;
  private digestGenerator: DigestGenerator;
  private anchorClient: RegistryAdapterClient;

  constructor(options: ApiServerOptions = {}) {
    this.fastify = Fastify({
      logger: {
        level: config.logging.level,
        prettyPrint: config.logging.pretty,
      },
    });

    this.prisma = getPrismaClient();
    this.aggregationService = new AggregationService();
    this.digestGenerator = new DigestGenerator();
    this.anchorClient = new RegistryAdapterClient();
  }

  async initialize(): Promise<void> {
    // Register plugins
    await this.fastify.register(helmet);
    await this.fastify.register(cors, {
      origin: false, // Disabled by default for security
    });
    
    await this.fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });

    // Register routes
    await this.registerRoutes();
    
    // Register dashboard routes
    await registerDashboardRoutes(this.fastify);

    // Register error handler
    this.fastify.setErrorHandler((error, request, reply) => {
      this.fastify.log.error(error);
      reply.status(500).send({
        error: 'Internal Server Error',
        message: config.nodeEnv === 'development' ? error.message : 'Something went wrong',
      });
    });
  }

  private async registerRoutes(): Promise<void> {
    // Health check
    this.fastify.get('/health', async (request, reply) => {
      const dbHealth = await healthCheck();
      const anchorHealth = await this.anchorClient.checkAnchorStatus();
      
      return {
        ok: dbHealth.ok,
        db: dbHealth.ok,
        anchor: anchorHealth.ok,
        timestamp: new Date().toISOString(),
      };
    });

    // Metrics endpoint
    this.fastify.get('/metrics', async (request, reply) => {
      // Basic metrics - can be extended with prom-client
      const sites = await this.prisma.site.count();
      const telemetryCount = await this.prisma.telemetry.count();
      const digestCount = await this.prisma.dailyDigest.count();
      
      return {
        sites,
        telemetry_records: telemetryCount,
        daily_digests: digestCount,
        timestamp: new Date().toISOString(),
      };
    });

    // Sites routes
    this.fastify.get('/sites', async (request, reply) => {
      const sites = await this.prisma.site.findMany({
        select: {
          id: true,
          name: true,
          country: true,
          timezone: true,
          capacityDcKw: true,
          capacityAcKw: true,
          baselineKgPerKwh: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return { sites };
    });

    this.fastify.get('/sites/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      
      const site = await this.prisma.site.findUnique({
        where: { id },
      });

      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      return { site };
    });

    // Telemetry routes
    this.fastify.get('/sites/:id/telemetry', async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string; interval?: string };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { from, to, interval = '5m' } = request.query;

      // Validate site exists
      const site = await this.prisma.site.findUnique({ where: { id } });
      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      // Parse dates
      const fromDate = from ? new Date(from) : addDays(new Date(), -7);
      const toDate = to ? new Date(to) : new Date();

      // Parse interval
      const intervalMinutes = parseInt(interval.replace('m', '')) || 5;

      const telemetryGenerator = new TelemetryGenerator(site as SiteConfig, config.simSeed);
      const telemetry = await telemetryGenerator.getTelemetry(id, fromDate, toDate, intervalMinutes);

      return {
        siteId: id,
        from: formatUtc(fromDate),
        to: formatUtc(toDate),
        interval: `${intervalMinutes}m`,
        count: telemetry.length,
        data: telemetry,
      };
    });

    // Daily digests routes
    this.fastify.get('/sites/:id/daily', async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { from, to } = request.query;

      // Validate site exists
      const site = await this.prisma.site.findUnique({ where: { id } });
      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      // Parse dates
      const fromDate = from ? new Date(from) : addDays(new Date(), -30);
      const toDate = to ? new Date(to) : new Date();

      const digests = await this.aggregationService.getDailyDigests(id, fromDate, toDate);

      return {
        siteId: id,
        from: getDayUtc(fromDate),
        to: getDayUtc(toDate),
        count: digests.length,
        digests,
      };
    });

    // Generate telemetry for a specific day
    this.fastify.post('/sites/:id/generate', async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { day?: string; interval?: string };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { day, interval = '5m' } = request.query;

      // Validate site exists
      const site = await this.prisma.site.findUnique({ where: { id } });
      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      // Parse date
      const targetDay = day ? new Date(day) : addDays(new Date(), -1);
      const intervalMinutes = parseInt(interval.replace('m', '')) || 5;

      try {
        const telemetryGenerator = new TelemetryGenerator(site as SiteConfig, config.simSeed);
        
        // Delete existing telemetry for the day
        await telemetryGenerator.deleteTelemetryForDay(id, targetDay);
        
        // Generate new telemetry
        const telemetry = await telemetryGenerator.generateDayTelemetry(targetDay, intervalMinutes);
        
        // Generate hourly summaries
        await this.aggregationService.generateHourlySummaries(id, targetDay);
        
        // Generate daily digest
        const digest = await this.digestGenerator.generateAndStoreDigest(
          id,
          targetDay,
          site as SiteConfig,
          intervalMinutes
        );

        return {
          siteId: id,
          day: getDayUtc(targetDay),
          interval: `${intervalMinutes}m`,
          telemetryCount: telemetry.length,
          digest,
        };
      } catch (error) {
        this.fastify.log.error('Failed to generate telemetry:', error);
        return reply.status(500).send({
          error: 'Failed to generate telemetry',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Anchor a digest
    this.fastify.post('/sites/:id/anchor', async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { day?: string };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { day } = request.query;

      // Validate site exists
      const site = await this.prisma.site.findUnique({ where: { id } });
      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      // Parse date
      const targetDay = day ? new Date(day) : addDays(new Date(), -1);
      const dayUtc = getDayUtc(targetDay);

      try {
        // Get digest
        const digest = await this.aggregationService.getDailyDigest(id, targetDay);
        if (!digest) {
          return reply.status(404).send({ error: 'Digest not found for the specified day' });
        }

        // Anchor the digest
        const anchorResult = await this.anchorClient.anchorDigestWithRetry(
          id,
          dayUtc,
          digest.merkleRoot
        );

        if (anchorResult.success) {
          // Update digest with anchor information
          await this.aggregationService.updateDigestAnchor(
            id,
            dayUtc,
            anchorResult.adapterTxId,
            anchorResult.txHash
          );
        }

        return {
          siteId: id,
          day: dayUtc,
          anchorResult,
        };
      } catch (error) {
        this.fastify.log.error('Failed to anchor digest:', error);
        return reply.status(500).send({
          error: 'Failed to anchor digest',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Preview today's data
    this.fastify.get('/sites/:id/preview/today', async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply
    ) => {
      const { id } = request.params;

      // Validate site exists
      const site = await this.prisma.site.findUnique({ where: { id } });
      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      try {
        const today = new Date();
        const telemetryGenerator = new TelemetryGenerator(site as SiteConfig, config.simSeed);
        
        // Get latest telemetry
        const latestTelemetry = await telemetryGenerator.getLatestTelemetry(id, 1);
        const powerNow = latestTelemetry.length > 0 ? latestTelemetry[0].acPowerKw : 0;
        
        // Get today's statistics
        const todayStats = await telemetryGenerator.getDayStatistics(id, today);
        
        // Get latest digest
        const latestDigest = await this.aggregationService.getLatestDailyDigest(id);

        return {
          siteId: id,
          powerNow,
          energyToday: todayStats.totalEnergy,
          avoidedTco2eToday: (todayStats.totalEnergy * site.baselineKgPerKwh) / 1000,
          lastDigest: latestDigest,
        };
      } catch (error) {
        this.fastify.log.error('Failed to get preview data:', error);
        return reply.status(500).send({
          error: 'Failed to get preview data',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }

  async start(port?: number, host?: string): Promise<void> {
    try {
      const address = await this.fastify.listen({
        port: port || config.port,
        host: host || '0.0.0.0',
      });
      
      this.fastify.log.info(`Server listening at ${address}`);
    } catch (error) {
      this.fastify.log.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.fastify.close();
      this.fastify.log.info('Server stopped');
    } catch (error) {
      this.fastify.log.error('Failed to stop server:', error);
      throw error;
    }
  }

  getFastifyInstance(): FastifyInstance {
    return this.fastify;
  }
}
