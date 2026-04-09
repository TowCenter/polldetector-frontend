import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// CORS configuration - use FRONTEND_ORIGIN env var in production
const allowedOrigin = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

app.use(express.json());

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE || 'pollfinder';
const COLLECTION_NAME = 'expanded_polls';

// Check if environment variables are set
if (!MONGODB_URI) {
  console.error('❌ MONGODB_CONNECTION_STRING environment variable is not set');
  console.log('Available environment variables:');
  console.log(Object.keys(process.env).filter(key => key.includes('MONGO')));
  process.exit(1);
}

let db;
let expandedPolls;

// Connect to MongoDB
MongoClient.connect(MONGODB_URI)
  .then(client => {
    console.log('✅ Connected to MongoDB');
    db = client.db(DB_NAME);
    expandedPolls = db.collection(COLLECTION_NAME);
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// API endpoint to fetch polls
app.get('/api/polls', async (req, res) => {
  try {
    const { date, collection } = req.query;
    console.log('📅 Received query - date:', date, 'collection:', collection);
    
    let query = {
      // Required filters
      polls_mentioned: true,
      num_polls_found: { $lt: 3 }
    };
    
    // Add date filter if provided (added_on is stored as Date object)
    if (date) {
      // Create date range for the entire day in UTC (00:00:00 to 23:59:59 UTC)
      const startDate = new Date(date + 'T00:00:00.000Z');
      const endDate = new Date(date + 'T23:59:59.999Z');
      
      console.log('📅 Date filter:', { date, startDate, endDate });
      
      query.added_on = { 
        $gte: startDate,
        $lte: endDate
      };
    }
    
    // Add collection filter if provided
    if (collection) {
      query.collections = { $regex: collection, $options: 'i' };
    }
    
    console.log('📊 Query:', JSON.stringify(query));
    
    const polls = await expandedPolls.find(query).sort({ added_on: -1 }).toArray();
    
    console.log(`✅ Found ${polls.length} polls`);
    
    // Transform MongoDB documents to match your expected format
    const transformedPolls = polls.map(poll => ({
      id: poll.id,
      url: poll.url,
      added_on: poll.added_on,
      collections: poll.collections,
      polls_mentioned: poll.polls_mentioned,
      num_polls_found: poll.num_polls_found,
      feedback: poll.feedback || null, // Include feedback from DB
      notes: poll.notes || null, // Include notes from DB
      temp_poll_id: poll.temp_poll_id || null, // Include temp_poll_id
      // Create polls object from the extracted fields
      polls: poll.polls_mentioned ? [{
        pollster: poll.pollster,
        sponsor: poll.sponsor,
        date: poll.date,
        location: poll.location,
        sample_size: poll.sample_size,
        poll_url: poll.poll_url
      }] : [],
      // Create match_results from canonical_poll_data
      match_results: poll.canonical_poll_data ? {
        success: true,
        matches: [{
          confidence: 'high',
          matched_poll: poll.canonical_poll_data
        }]
      } : null,
      match_poll_id: poll.match_poll_id
    }));
    
    res.json(transformedPolls);
  } catch (error) {
    console.error('❌ Error fetching polls:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to update feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { id, feedback } = req.body;
    
    if (!id || !feedback) {
      return res.status(400).json({ error: 'Missing id or feedback' });
    }
    
    if (!['correct', 'incorrect', 'not_interested'].includes(feedback)) {
      return res.status(400).json({ error: 'Invalid feedback value' });
    }
    
    console.log(`📝 Updating feedback for ID ${id} to: ${feedback}`);
    
    const result = await expandedPolls.updateOne(
      { id: id },
      { $set: { feedback: feedback } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    console.log(`✅ Feedback updated successfully`);
    res.json({ success: true, message: 'Feedback updated' });
  } catch (error) {
    console.error('❌ Error updating feedback:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to update notes
app.post('/api/notes', async (req, res) => {
  try {
    const { id, notes } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }
    
    console.log(`📝 Updating notes for ID ${id}`);
    
    const result = await expandedPolls.updateOne(
      { id: id },
      { $set: { notes: notes || null } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    console.log(`✅ Notes updated successfully`);
    res.json({ success: true, message: 'Notes updated' });
  } catch (error) {
    console.error('❌ Error updating notes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to get the first-seen date for temp_poll_ids
app.get('/api/temp-poll-first-seen', async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ error: 'Missing ids parameter' });
    }

    const tempPollIds = ids.split(',').filter(Boolean);
    console.log(`🔍 Looking up first-seen dates for ${tempPollIds.length} temp_poll_ids`);

    const pipeline = [
      { $match: { temp_poll_id: { $in: tempPollIds } } },
      { $group: { _id: '$temp_poll_id', first_seen: { $min: '$added_on' } } }
    ];

    const results = await expandedPolls.aggregate(pipeline).toArray();
    const firstSeenMap = {};
    results.forEach(r => {
      firstSeenMap[r._id] = r.first_seen;
    });

    res.json(firstSeenMap);
  } catch (error) {
    console.error('❌ Error fetching temp poll first-seen dates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Pollfinder API', 
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      polls: '/api/polls?date=YYYY-MM-DD',
      feedback: 'POST /api/feedback',
      notes: 'POST /api/notes'
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running on http://0.0.0.0:${PORT}`);
  console.log(`   Local: http://localhost:${PORT}`);
});// Clean API deployment Tue Oct 14 16:58:03 EDT 2025
// Fresh deployment Tue Oct 14 17:06:47 EDT 2025
