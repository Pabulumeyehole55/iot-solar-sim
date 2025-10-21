# Contributing to IoT Solar Simulator

Thank you for your interest in contributing to the IoT Solar Simulator! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/iot-solar-sim.git
   cd iot-solar-sim
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up environment**:
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```
5. **Initialize database**:
   ```bash
   npm run db:migrate
   npm run db:generate
   ```

## 🛠️ Development Workflow

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- pv-simulation.test.ts
```

### Code Style
- Use TypeScript with strict mode enabled
- Follow existing code patterns and naming conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Ensure all tests pass before submitting

### Database Changes
When modifying the Prisma schema:
1. Update `prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Update any affected code
4. Add/update tests as needed

## 📝 Submitting Changes

### Pull Request Process
1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** and ensure tests pass
3. **Commit your changes**:
   ```bash
   git commit -m "Add: Brief description of changes"
   ```
4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
5. **Create a Pull Request** on GitHub

### Commit Message Format
Use conventional commits format:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions or changes
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Maintenance tasks

Examples:
- `feat: add MQTT telemetry streaming`
- `fix: correct CO2 calculation for negative values`
- `docs: update API documentation`

## 🧪 Testing Guidelines

### Unit Tests
- Test individual functions and classes
- Use descriptive test names
- Test edge cases and error conditions
- Aim for high code coverage

### Integration Tests
- Test API endpoints
- Test database operations
- Test external service integrations
- Use test database for isolation

### Property Tests
- Test mathematical properties (energy monotonicity, power clipping)
- Test deterministic behavior with same seeds
- Test boundary conditions

## 🏗️ Architecture Guidelines

### Adding New Sites
1. Create site config JSON in `src/config/sites/`
2. Add site ID to `SITE_IDS` environment variable
3. Update tests if needed

### Extending PV Model
The PV simulation model can be extended for:
- Different module types
- Tracking systems
- Shading effects
- Advanced weather models

### Adding New APIs
1. Add route handlers in `src/api/server.ts`
2. Add input validation with Zod schemas
3. Add error handling
4. Add tests for new endpoints
5. Update API documentation

## 🐛 Bug Reports

When reporting bugs, please include:
- **Environment**: OS, Node.js version, dependencies
- **Steps to reproduce**: Clear, numbered steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Error messages**: Full error logs if applicable
- **Screenshots**: If UI-related

## 💡 Feature Requests

When suggesting features, please include:
- **Use case**: Why is this feature needed?
- **Proposed solution**: How should it work?
- **Alternatives**: Other approaches considered
- **Additional context**: Any other relevant information

## 📋 Code Review Checklist

Before submitting, ensure:
- [ ] All tests pass
- [ ] Code follows project style guidelines
- [ ] New features have tests
- [ ] Documentation is updated
- [ ] No console.log statements in production code
- [ ] Error handling is appropriate
- [ ] Performance considerations addressed

## 🤝 Community Guidelines

- Be respectful and constructive
- Help others learn and grow
- Follow the project's code of conduct
- Ask questions if you're unsure about anything

## 📞 Getting Help

- **Documentation**: Check README.md and inline code comments
- **Issues**: Search existing issues before creating new ones
- **Discussions**: Use GitHub Discussions for questions
- **Code Review**: Request reviews from maintainers

## 🎯 Areas for Contribution

- **New Features**: MQTT streaming, advanced weather models, mobile dashboard
- **Performance**: Database optimization, caching, query improvements
- **Testing**: More comprehensive test coverage
- **Documentation**: API docs, tutorials, examples
- **DevOps**: CI/CD pipelines, monitoring, alerting
- **Security**: Security audits, vulnerability scanning

Thank you for contributing to the IoT Solar Simulator! 🌞⚡
