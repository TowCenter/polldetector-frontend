import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://tow_pollfinder:7vjTHLrQZZxXzTHx@pollfinder.x6vlq6c.mongodb.net/';
const client = new MongoClient(uri);

(async () => {
  try {
    await client.connect();
    const db = client.db('pollfinder');
    const collection = db.collection('expanded_polls');
    
    // Find one document with temp_poll_id
    const doc = await collection.findOne({
      added_on: { $regex: '^2025-10-19' },
      temp_poll_id: 'TEMP-20251019-F98461E7'
    });
    
    if (doc) {
      console.log('Found document with temp_poll_id:');
      console.log('URL:', doc.url);
      console.log('Pollster:', doc.pollster);
      console.log('temp_poll_id:', doc.temp_poll_id);
      console.log('match_poll_id:', doc.match_poll_id);
      console.log('\nAll fields:');
      console.log(Object.keys(doc).sort());
    } else {
      console.log('No document found with TEMP-20251019-F98461E7');
    }
  } finally {
    await client.close();
  }
})().catch(console.error);
