require('dotenv').config();
const express = require('express');
const snoowrap = require('snoowrap');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 4000;

// Initialize Reddit API client
const reddit = new snoowrap({
  userAgent: 'UGC-App/1.0 by YourUsername',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3001',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Test Reddit API authentication
reddit.getMe().then(user => {
  console.log('Authenticated as:', user.name);
}).catch(err => {
  console.error('Authentication failed:', err);
});

// Search endpoint
app.get('/search', async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const posts = await reddit.search({ query, sort: 'relevance', limit: 10 });
    const formattedPosts = posts.map(post => ({
      title: post.title,
      subreddit: post.subreddit.display_name,
      author: post.author.name,
      comments: post.num_comments,
      post_id: post.id,
      created_utc: post.created_utc, // Post creation timestamp (Unix epoch)
      score: post.score, // Upvotes minus downvotes
      url: post.url, // URL of the post (might be an image or external link)
      thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null, // Thumbnail image if available
      is_image: post.post_hint === 'image', // Indicates if the post is an image
    }));
    res.json(formattedPosts);
  } catch (error) {
    console.error('Error fetching search results:', error);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

// Thread endpoint
app.get('/thread', async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  try {
    const submission = await reddit.getSubmission(id).fetch();
    const comments = await submission.comments.fetchMore({ amount: 10 });
    const formattedComments = comments.map(comment => ({
      id: comment.id,
      author: comment.author.name,
      body: comment.body,
      created_utc: comment.created_utc, // Comment creation timestamp
      score: comment.score, // Comment upvotes
    }));

    const post = {
      title: submission.title,
      subreddit: submission.subreddit.display_name,
      author: submission.author.name,
      body: submission.selftext || 'No body content',
      created_utc: submission.created_utc, // Post creation timestamp
      score: submission.score, // Post upvotes
      url: submission.url, // URL of the post (might be an image or external link)
      thumbnail: submission.thumbnail && submission.thumbnail !== 'self' && submission.thumbnail !== 'default' ? submission.thumbnail : null,
      is_image: submission.post_hint === 'image',
      comments: formattedComments,
    };
    res.json(post);
  } catch (error) {
    console.error('Error fetching thread:', error);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});