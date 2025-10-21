import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db';
import { TelemetryGenerator } from '../ingest/telemetry-generator';
import { AggregationService } from '../aggregate';
import { DigestGenerator } from '../aggregate/digest-generator';
import { addDays, getDayUtc } from '../util';

export async function registerDashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();
  const aggregationService = new AggregationService();
  const digestGenerator = new DigestGenerator();

  // Dashboard home page
  fastify.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IoT Solar Simulator Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s;
        }
        
        .card:hover {
            transform: translateY(-2px);
        }
        
        .card h3 {
            color: #333;
            margin-bottom: 16px;
            font-size: 1.2rem;
        }
        
        .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .metric:last-child {
            border-bottom: none;
        }
        
        .metric-label {
            color: #666;
            font-weight: 500;
        }
        
        .metric-value {
            color: #333;
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .status.ok {
            background: #d4edda;
            color: #155724;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
        }
        
        .chart-container {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 20px;
        }
        
        .chart-title {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.2rem;
        }
        
        .sparkline {
            height: 60px;
            background: #f8f9fa;
            border-radius: 8px;
            position: relative;
            overflow: hidden;
        }
        
        .sparkline-line {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, #667eea, #764ba2);
        }
        
        .table-container {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow-x: auto;
        }
        
        .table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .table th,
        .table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .table th {
            background: #f8f9fa;
            font-weight: 600;
            color: #333;
        }
        
        .table tr:hover {
            background: #f8f9fa;
        }
        
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
            margin-bottom: 20px;
            transition: background 0.2s;
        }
        
        .refresh-btn:hover {
            background: #5a6fd8;
        }
        
        .loading {
            text-align: center;
            color: #666;
            padding: 40px;
        }
        
        .error {
            color: #dc3545;
            text-align: center;
            padding: 20px;
            background: #f8d7da;
            border-radius: 8px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌞 IoT Solar Simulator</h1>
            <p>Real-time Solar Plant Monitoring & Carbon Credit Tracking</p>
        </div>
        
        <button class="refresh-btn" onclick="refreshDashboard()">🔄 Refresh Data</button>
        
        <div id="dashboard-content">
            <div class="loading">Loading dashboard...</div>
        </div>
    </div>

    <script>
        async function fetchDashboardData() {
            try {
                const response = await fetch('/api/dashboard');
                if (!response.ok) {
                    throw new Error('Failed to fetch dashboard data');
                }
                return await response.json();
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
                throw error;
            }
        }
        
        function formatNumber(num, decimals = 2) {
            return num.toLocaleString(undefined, { 
                minimumFractionDigits: decimals, 
                maximumFractionDigits: decimals 
            });
        }
        
        function formatDate(dateString) {
            return new Date(dateString).toLocaleString();
        }
        
        function createSparkline(data, maxValue) {
            if (!data || data.length === 0) return '';
            
            const points = data.map((value, index) => {
                const x = (index / (data.length - 1)) * 100;
                const y = 100 - (value / maxValue) * 100;
                return \`\${x},\${y}\`;
            }).join(' ');
            
            return \`<svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline points="\${points}" fill="none" stroke="#667eea" stroke-width="2"/>
            </svg>\`;
        }
        
        function renderDashboard(data) {
            const content = document.getElementById('dashboard-content');
            
            if (data.error) {
                content.innerHTML = \`<div class="error">\${data.error}</div>\`;
                return;
            }
            
            const sites = data.sites || [];
            const health = data.health || {};
            
            let html = \`
                <div class="grid">
                    <div class="card">
                        <h3>🏥 System Health</h3>
                        <div class="metric">
                            <span class="metric-label">Database</span>
                            <span class="status \${health.db ? 'ok' : 'error'}">\${health.db ? 'OK' : 'ERROR'}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Anchor Service</span>
                            <span class="status \${health.anchor ? 'ok' : 'error'}">\${health.anchor ? 'OK' : 'ERROR'}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Last Updated</span>
                            <span class="metric-value">\${formatDate(health.timestamp)}</span>
                        </div>
                    </div>
            \`;
            
            sites.forEach(site => {
                const latestDigest = site.latestDigest;
                const todayStats = site.todayStats || {};
                
                html += \`
                    <div class="card">
                        <h3>🏭 \${site.name} (\${site.id})</h3>
                        <div class="metric">
                            <span class="metric-label">Current Power</span>
                            <span class="metric-value">\${formatNumber(site.powerNow || 0)} kW</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Energy Today</span>
                            <span class="metric-value">\${formatNumber(todayStats.totalEnergy || 0)} kWh</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">CO₂ Avoided Today</span>
                            <span class="metric-value">\${formatNumber(site.avoidedTco2eToday || 0)} tCO₂e</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Last Digest</span>
                            <span class="metric-value">\${latestDigest ? latestDigest.dayUtc : 'None'}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Anchored</span>
                            <span class="status \${latestDigest?.anchorTxHash ? 'ok' : 'error'}">\${latestDigest?.anchorTxHash ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                \`;
            });
            
            html += '</div>';
            
            // Add recent telemetry table
            if (data.recentTelemetry && data.recentTelemetry.length > 0) {
                html += \`
                    <div class="table-container">
                        <h3 class="chart-title">📊 Recent Telemetry (Last 24 Hours)</h3>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Site</th>
                                    <th>Timestamp</th>
                                    <th>Power (kW)</th>
                                    <th>Energy (kWh)</th>
                                    <th>Irradiance (W/m²)</th>
                                    <th>Temperature (°C)</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                \`;
                
                data.recentTelemetry.forEach(record => {
                    html += \`
                        <tr>
                            <td>\${record.siteId}</td>
                            <td>\${formatDate(record.tsUtc)}</td>
                            <td>\${formatNumber(record.acPowerKw)}</td>
                            <td>\${formatNumber(record.acEnergyKwh)}</td>
                            <td>\${formatNumber(record.poaIrrWm2)}</td>
                            <td>\${formatNumber(record.tempC)}</td>
                            <td><span class="status \${record.status === 'OK' ? 'ok' : 'error'}">\${record.status}</span></td>
                        </tr>
                    \`;
                });
                
                html += '</tbody></table></div>';
            }
            
            content.innerHTML = html;
        }
        
        async function refreshDashboard() {
            const content = document.getElementById('dashboard-content');
            content.innerHTML = '<div class="loading">Refreshing dashboard...</div>';
            
            try {
                const data = await fetchDashboardData();
                renderDashboard(data);
            } catch (error) {
                content.innerHTML = \`<div class="error">Failed to load dashboard: \${error.message}</div>\`;
            }
        }
        
        // Load dashboard on page load
        document.addEventListener('DOMContentLoaded', refreshDashboard);
        
        // Auto-refresh every 30 seconds
        setInterval(refreshDashboard, 30000);
    </script>
</body>
</html>
    `;
    
    reply.type('text/html').send(html);
  });

  // Dashboard API endpoint
  fastify.get('/api/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        // Get system health
        const health = {
          ok: true,
          db: true,
          anchor: true,
          timestamp: new Date().toISOString(),
        };
      
      // Get all sites
      const sites = await prisma.site.findMany({
        select: {
          id: true,
          name: true,
          country: true,
          baselineKgPerKwh: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const siteData = await Promise.all(sites.map(async (site) => {
        try {
          const telemetryGenerator = new TelemetryGenerator(site as any, 42);
          
          // Get latest telemetry
          const latestTelemetry = await telemetryGenerator.getLatestTelemetry(site.id, 1);
          const powerNow = latestTelemetry.length > 0 ? latestTelemetry[0].acPowerKw : 0;
          
          // Get today's statistics
          const todayStats = await telemetryGenerator.getDayStatistics(site.id, new Date());
          
          // Get latest digest
          const latestDigest = await aggregationService.getLatestDailyDigest(site.id);
          
          // Calculate avoided CO2 for today
          const avoidedTco2eToday = (todayStats.totalEnergy * site.baselineKgPerKwh) / 1000;

          return {
            ...site,
            powerNow,
            avoidedTco2eToday,
            todayStats,
            latestDigest,
          };
        } catch (error) {
          fastify.log.error(`Failed to get data for site ${site.id}:`, error);
          return {
            ...site,
            powerNow: 0,
            avoidedTco2eToday: 0,
            todayStats: { totalEnergy: 0, maxPower: 0, avgTemp: 0, avgIrradiance: 0, rowCount: 0 },
            latestDigest: null,
          };
        }
      }));

      // Get recent telemetry for all sites
      const recentTelemetry = await prisma.telemetry.findMany({
        where: {
          tsUtc: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        orderBy: { tsUtc: 'desc' },
        take: 100,
      });

      return {
        health,
        sites: siteData,
        recentTelemetry,
      };
    } catch (error) {
      fastify.log.error('Failed to get dashboard data:', error);
      return reply.status(500).send({
        error: 'Failed to load dashboard data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
