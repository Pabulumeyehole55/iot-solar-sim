# IoT Solar Simulator

A deterministic, configurable IoT simulator for grid-connected solar PV plants that generates realistic telemetry data, computes daily/weekly digests, and anchors digest hashes to the blockchain for carbon credit verification.

## 🌟 Features

- **Realistic Solar Simulation**: Generates time-series telemetry with day/night cycles, weather variation, degradation, and outages
- **Deterministic Generation**: Seeded RNG ensures reproducible results for demos and testing
- **Daily Digests**: Computes Merkle-rooted digests with kWh → tCO2e avoided calculations
- **Blockchain Anchoring**: Optional anchoring of digest hashes via registry-adapter-api
- **REST APIs**: Complete API for sites, telemetry, and digest management
- **Live Dashboard**: Real-time visualization of solar plant performance
- **Docker Ready**: Containerized deployment with docker-compose
- **CLI Tools**: Scripts for seeding, backfilling, and anchoring

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (optional)

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd iot-solar-sim
npm install
```

2. **Set up environment:**
```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Initialize database:**
```bash
npm run db:migrate
npm run db:generate
```

4. **Seed with sample data:**
```bash
npm run seed
```

5. **Start the server:**
```bash
npm run dev
```

The API will be available at `http://localhost:4200` and the dashboard at `http://localhost:4200/dashboard`.

### Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f iot-solar-sim

# Stop services
docker-compose down
```

## 📊 Architecture

### Core Components

- **PV Simulation Model**: Calculates irradiance, temperature, and power based on solar geometry and weather
- **Telemetry Generator**: Creates deterministic time-series data with configurable intervals
- **Aggregation Service**: Builds hourly summaries and daily digests
- **Digest Generator**: Creates Merkle-rooted JSON/CSV artifacts
- **Anchor Client**: Communicates with registry-adapter-api for blockchain anchoring
- **REST API**: Fastify-based HTTP API with health checks and metrics
- **Dashboard UI**: Real-time web interface for monitoring

### Data Flow

```
Solar Site Config → PV Model → Telemetry Generator → Database
                                                      ↓
Blockchain ← Registry Adapter ← Anchor Client ← Daily Digest ← Aggregation
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4200 | API server port |
| `DATABASE_URL` | `file:./sim.db` | SQLite database path |
| `SIM_SEED` | 42 | RNG seed for deterministic generation |
| `INTERVAL_SECONDS` | 60 | Live simulation interval |
| `DEFAULT_INTERVAL_MINUTES` | 5 | Default telemetry interval |
| `ANCHOR_ENABLED` | true | Enable blockchain anchoring |
| `ADAPTER_API_URL` | `http://localhost:4100` | Registry adapter API URL |
| `SITE_IDS` | `PRJ001,PRJ002` | Comma-separated site IDs |
| `BASELINE_FACTOR_KG_PER_KWH_IN` | 0.708 | India emission factor |
| `BASELINE_FACTOR_KG_PER_KWH_DEFAULT` | 0.82 | Default emission factor |

### Site Configuration

Sites are configured via JSON files in `src/config/sites/`:

```json
{
  "siteId": "PRJ001",
  "name": "Solar Farm C",
  "country": "IN",
  "timezone": "Asia/Kolkata",
  "lat": 18.52,
  "lon": 73.85,
  "capacityDcKW": 12000,
  "capacityAcKW": 10000,
  "tiltDeg": 20,
  "azimuthDeg": 180,
  "modules": 22000,
  "inverterEff": 0.972,
  "degradationPctPerYear": 0.5,
  "baselineKgPerKwh": 0.708,
  "outageWindows": [
    {
      "start": "03:00",
      "end": "03:30",
      "days": "SUN"
    }
  ],
  "curtailmentPct": 0.03
}
```

## 📡 API Reference

### Health & Metrics

- `GET /health` - System health check
- `GET /metrics` - Basic metrics (sites, telemetry count, digests)

### Sites

- `GET /sites` - List all sites
- `GET /sites/:id` - Get site details

### Telemetry

- `GET /sites/:id/telemetry?from=&to=&interval=` - Get telemetry data
- `POST /sites/:id/generate?day=&interval=` - Generate telemetry for a day

### Digests

- `GET /sites/:id/daily?from=&to=` - Get daily digests
- `POST /sites/:id/anchor?day=` - Anchor a digest to blockchain

### Preview

- `GET /sites/:id/preview/today` - Get today's summary data

### Dashboard

- `GET /dashboard` - Web dashboard interface
- `GET /api/dashboard` - Dashboard API data

## 🛠️ CLI Tools

### Seed Script
```bash
npm run seed
```
Creates sample sites and generates yesterday's data with anchored digest.

### Backfill Script
```bash
npm run backfill -- --site PRJ001 --from 2025-01-01 --to 2025-01-31 --interval 5m
```
Generates historical telemetry and digests for a date range.

### Anchor Script
```bash
npm run anchor -- --site PRJ001 --day 2025-10-20
```
Anchors a specific day's digest to the blockchain.

### Live Simulation
```bash
npm run live -- --site PRJ001 --interval 60s --duration 120
```
Runs live simulation for specified duration.

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- pv-simulation.test.ts
```

### Test Coverage

- **Unit Tests**: PV model, RNG, hashing, CO2 conversion
- **Integration Tests**: API endpoints, database operations
- **Property Tests**: Energy monotonicity, power clipping, outage effects

## 📈 Monitoring & Observability

### Health Checks

- Database connectivity
- Registry adapter API status
- System metrics

### Metrics

- Site count
- Telemetry record count
- Daily digest count
- Anchor success/failure rates

### Logging

Structured logging with Pino:
- Request/response logging
- Error tracking
- Performance metrics
- Audit trail for anchoring

## 🔒 Security

- **No PII**: Only plant IDs and hashes stored
- **Rate Limiting**: API rate limits (100 req/min)
- **CORS**: Disabled by default
- **HMAC Signing**: Optional for adapter API calls
- **Input Validation**: Zod schema validation

## 🌍 Carbon Credit Integration

### Emission Factors

Default emission factors by country:
- India: 0.708 kg CO2e/kWh
- USA: 0.386 kg CO2e/kWh
- EU: 0.255 kg CO2e/kWh
- China: 0.581 kg CO2e/kWh

### Digest Format

Daily digests include:
- Site ID and date
- Total energy (kWh)
- Avoided CO2 emissions (tCO2e)
- Merkle root hash
- Row count and metadata

### Anchoring Process

1. Generate daily digest with Merkle root
2. POST to registry-adapter-api `/v1/anchor`
3. Receive transaction hash and block number
4. Store anchor information in database

## 🐳 Docker Deployment

### Production Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  iot-solar-sim:
    build: .
    ports:
      - "4200:4200"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:./data/sim.db
      - ANCHOR_ENABLED=true
    volumes:
      - ./data:/app/data
    depends_on:
      - registry-adapter-api
```

### Environment Variables

Set these in your `.env` file or Docker environment:
- `BLOCKCHAIN_RPC_URL`: Ethereum RPC endpoint
- `PRIVATE_KEY`: Wallet private key for anchoring
- `CONTRACT_ADDRESS`: EvidenceAnchor contract address

## 📚 Development

### Project Structure

```
iot-solar-sim/
├── src/
│   ├── config/          # Configuration and site configs
│   ├── model/           # PV simulation model
│   ├── ingest/          # Telemetry generation
│   ├── aggregate/       # Aggregation and digest generation
│   ├── anchor/          # Blockchain anchoring client
│   ├── api/             # REST API server
│   ├── ui/              # Dashboard UI
│   ├── util/            # Utilities (RNG, hashing, time)
│   └── test/            # Test files
├── scripts/             # CLI scripts
├── prisma/              # Database schema
└── docker/              # Docker configuration
```

### Adding New Sites

1. Create site config JSON in `src/config/sites/`
2. Add site ID to `SITE_IDS` environment variable
3. Run `npm run seed` to create site in database

### Extending the PV Model

The PV simulation model can be extended to support:
- Different module types
- Tracking systems
- Shading effects
- More sophisticated weather models

### Custom Emission Factors

Add country-specific emission factors in `src/config/index.ts`:

```typescript
export const EMISSION_FACTORS = {
  // ... existing factors
  NEW_COUNTRY: 0.500,
} as const;
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the documentation
2. Review existing issues
3. Create a new issue with detailed information

## 🔮 Roadmap

- [ ] MQTT telemetry streaming
- [ ] Multi-site aggregation
- [ ] Advanced weather integration
- [ ] Performance optimization
- [ ] Additional blockchain networks
- [ ] Mobile dashboard
- [ ] Alert system
- [ ] Data export tools
