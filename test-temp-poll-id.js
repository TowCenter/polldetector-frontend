import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://tow_pollfinder:7vjTHLrQZZxXzTHx@pollfinder.x6vlq6c.mongodb.net/';
const client = new MongoClient(uri);

(async () => {
  try {
    await client.connect();
    const db = client.db('pollfinder');
    const collection = db.collection('expanded_polls');
    
    // Simulate what the API does
    const query = {
      polls_mentioned: true,
      num_polls_found: { $lt: 3 },
      added_on: { $regex: '^2025-10-19' }
    };
    
    const polls = await collection.find(query).sort({ added_on: -1 }).toArray();
    
    // Transform like the API does
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
    
    // Filter like frontend does
    const filtered = transformedPolls.filter(item => {
      const pollsArray = Array.isArray(item.polls) ? item.polls : (item.polls ? [item.polls] : []);
      const firstPoll = pollsArray[0];
      return firstPoll && firstPoll.pollster && firstPoll.pollster !== 'N/A';
    });
    
    console.log('Total transformed:', transformedPolls.length);
    console.log('After pollster filter:', filtered.length);
    console.log('Unmatched in filtered:', filtered.filter(p => !p.match_poll_id).length);
    
    // Show unmatched with temp_poll_id
    const unmatched = filtered.filter(p => !p.match_poll_id);
    console.log('\nUnmatched polls:');
    unmatched.forEach(p => {
      console.log({
        pollster: p.polls[0].pollster,
        temp_poll_id: p.temp_poll_id,
        match_poll_id: p.match_poll_id
      });
    });
  } finally {
    await client.close();
  }
})().catch(console.error);
