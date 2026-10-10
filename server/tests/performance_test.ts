
import { db } from '../db/index.js';
import { songs } from '../db/schema.js';
import { like, or } from 'drizzle-orm';
import { performance } from 'perf_hooks';

async function runBenchmark() {
  console.log('Starting benchmark...');
  const start = performance.now();
  
  // Simulated search query
  const searchStr = '%a%'; 
  
  const results = await db.select()
    .from(songs)
    .where(
      or(
        like(songs.title, searchStr),
      )
    )
    .limit(100);
    
  const end = performance.now();
  console.log(`Search query took: ${(end - start).toFixed(2)}ms`);
}

runBenchmark().catch(console.error);
