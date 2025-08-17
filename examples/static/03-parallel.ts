/**
 * Example: Parallel Execution
 *
 * Demonstrates running multiple operations concurrently using
 * Flow.parallel. All operations run at the same time, improving performance.
 *
 * Run: npx tsx examples/static/03-parallel.ts
 */

import { Effect, Flow, pipe } from '../../src/index';
import { Stream } from 'effect';

// Simulate API calls with delays
const fetchWeather = (city: string) =>
  Effect.promise(async () => {
    console.log(`  🌤️  Fetching weather for ${city}...`);
    await new Promise(r => setTimeout(r, 1000)); // Simulate network delay
    return {
      city,
      temp: Math.floor(Math.random() * 30) + 50,
      conditions: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)]
    };
  });

const fetchNews = (category: string) =>
  Effect.promise(async () => {
    console.log(`  📰 Fetching ${category} news...`);
    await new Promise(r => setTimeout(r, 1000)); // Simulate network delay
    return {
      category,
      headlines: [
        `Breaking: ${category} news item 1`,
        `Update: ${category} news item 2`
      ]
    };
  });

const fetchStockPrice = (symbol: string) =>
  Effect.promise(async () => {
    console.log(`  📈 Fetching stock price for ${symbol}...`);
    await new Promise(r => setTimeout(r, 1000)); // Simulate network delay
    return {
      symbol,
      price: (Math.random() * 1000).toFixed(2),
      change: (Math.random() * 10 - 5).toFixed(2)
    };
  });

// Create a dashboard flow that fetches all data in parallel
const dashboardFlow = pipe(
  // Fetch multiple data sources in parallel
  Flow.parallel({
    weather: fetchWeather('San Francisco'),
    techNews: fetchNews('Technology'),
    businessNews: fetchNews('Business'),
    stockAAPL: fetchStockPrice('AAPL'),
    stockGOOGL: fetchStockPrice('GOOGL')
  }),

  // Process the combined results
  Flow.map(data => ({
    timestamp: new Date().toISOString(),
    dashboard: {
      weather: `${data.weather.city}: ${data.weather.temp}°F, ${data.weather.conditions}`,
      news: [
        ...data.techNews.headlines,
        ...data.businessNews.headlines
      ],
      stocks: [
        `${data.stockAAPL.symbol}: $${data.stockAAPL.price} (${data.stockAAPL.change}%)`,
        `${data.stockGOOGL.symbol}: $${data.stockGOOGL.price} (${data.stockGOOGL.change}%)`
      ]
    }
  }))
);

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Parallel Execution example...');
  console.log('📝 This demonstrates concurrent operations with Flow.parallel');
  console.log('⏱️  Note: All operations run simultaneously, not sequentially');

  // Execute: Sync collect
  console.log('\n— Sync (collect) —');
  const startTime = Date.now();
  const result = await Effect.runPromise(dashboardFlow);
  const duration = Date.now() - startTime;

  console.log(`\n⏱️  Total time: ${duration}ms (parallel execution)`);
  console.log(`🌤️  Weather: ${result.dashboard.weather}`);
  console.log(`📰 News items: ${result.dashboard.news.length}`);
  console.log(`📈 Stocks tracked: ${result.dashboard.stocks.length}`);

  // Execute: Streaming (single emission)
  console.log('\n— Streaming —');
  const streamStartTime = Date.now();
  await Stream.runForEach(Stream.fromEffect(dashboardFlow), (value) =>
    Effect.sync(() => {
      console.log('event:dashboard', {
        weather: value.dashboard.weather,
        newsCount: value.dashboard.news.length,
        stocksCount: value.dashboard.stocks.length
      });
    })
  ).pipe(Effect.runPromise);
  const streamDuration = Date.now() - streamStartTime;

  console.log(`⏱️  Stream time: ${streamDuration}ms`);
  console.log('\n✅ Completed both modes successfully');

  return result;
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(error => {
    console.error('❌ Parallel Execution example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * 🚀 Starting Parallel Execution example...
 * 📝 This demonstrates concurrent operations with Flow.parallel
 * ⏱️  Note: All operations run simultaneously, not sequentially
 *
 * — Sync (collect) —
 *   🌤️  Fetching weather for San Francisco...
 *   📰 Fetching Technology news...
 *   📰 Fetching Business news...
 *   📈 Fetching stock price for AAPL...
 *   📈 Fetching stock price for GOOGL...
 *
 * ⏱️  Total time: 5011ms (parallel execution)
 * 🌤️  Weather: San Francisco: 66°F, sunny
 * 📰 News items: 4
 * 📈 Stocks tracked: 2
 *
 * — Streaming —
 *   🌤️  Fetching weather for San Francisco...
 *   📰 Fetching Technology news...
 *   📰 Fetching Business news...
 *   📈 Fetching stock price for AAPL...
 *   📈 Fetching stock price for GOOGL...
 * event:dashboard { weather: 'San Francisco: 75°F, sunny', newsCount: 4, stocksCount: 2 }
 * ⏱️  Stream time: 5018ms
 *
 * ✅ Completed both modes successfully
 */
