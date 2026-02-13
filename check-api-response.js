import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://tow_pollfinder:7vjTHLrQZZxXzTHx@pollfinder.x6vlq6c.mongodb.net/';
const client = new MongoClient(uri);

(async () => {
  try {
    await client.connect();
    const db = client.db('pollfinder');
    const collection = db.collection('expanded_polls');
    
    // Simulate exactly what the API does
    const query = {
      polls_mentioned: true,
      num_polls_found: { $lt: 3 },
      added_on: { $regex: '^2025-10-19' }
    };
    
    const polls = await collection.find(query).sort({ added_on: -1 }).toArray();
    
    // Transform like the API
    const transformedPolls = polls.map(poll => ({
      id: poll.id,
      url: poll.url,
      added_on: poll.added_on,
      collections: poll.collections,
      polls_mentioned: poll.polls_mentioned,
      num_polls_found: poll.num_polls_found,
      feedback: poll.feedback || null,
      notes: poll.notes || null,
      temp_poll_id: poll.temp_poll_id || null,
      polls: poll.polls_mentioned ? [{
        pollster: poll.pollster,
        sponsor: poll.sponsor,
        date: poll.date,
        location: poll.location,
        sample_size: poll.sample_size,
        poll_url: poll.poll_url
      }] : [],
      match_results: poll.canonical_poll_data ? {
        success: true,
        matches: [{
          confidence: 'high',
          matched_poll: poll.canonical_poll_data
        }]
      } : null,
      match_poll_id: poll.match_poll_id
    }));
    
    // Find the unmatched polls
    const unmatched = transformedPolls.filter(p => !p.match_poll_id);
    
    console.log('Unmatched polls in transformed response:');
    unmatched.forEach(p => {
      console.log({
        pollster: p.polls[0].pollster,
        temp_poll_id: p.temp_poll_id,
        match_poll_id: p.match_poll_id
      });
    });
    
    // Check if temp_poll_id shows in JSON stringify
    console.log('\nJSON of first unmatched:');
    console.log(JSON.stringify(unmatched[0], null, 2).substring(0, 500));
  } finally {
    await client.close();
  }
})().catch(console.error);
