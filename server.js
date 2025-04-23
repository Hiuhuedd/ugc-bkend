const express = require('express');
const snoowrap = require('snoowrap');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Reddit API setup
const r = new snoowrap({
  userAgent: 'ugc-app/0.1 by hiuhuk',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Google Search API setup
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// Helper function to auto-scroll Quora page (for thread endpoint)
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// Reddit Search Endpoint
app.get('/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const searchResults = await r.search({ query: query, limit: 10 });
    const posts = searchResults.map(post => ({
      post_id: post.id,
      title: post.title,
      subreddit: post.subreddit.display_name,
      author: post.author.name,
      score: post.score,
      comments: post.num_comments,
      created_utc: post.created_utc,
      thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
      url: post.url,
      is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
    }));
    res.json(posts);
  } catch (error) {
    console.error('Reddit search error:', error);
    res.status(500).json({ error: 'Failed to fetch search results from Reddit' });
  }
});

// Reddit Thread Endpoint
app.get('/thread', async (req, res) => {
  const postId = req.query.id;
  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  try {
    const post = await r.getSubmission(postId).fetch();
    const comments = await post.comments.fetchMore({ amount: 10 });

    const thread = {
      post_id: post.id,
      title: post.title,
      subreddit: post.subreddit.display_name,
      author: post.author.name,
      score: post.score,
      created_utc: post.created_utc,
      body: post.selftext || '',
      thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
      url: post.url,
      is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
      comments: comments.map(comment => ({
        id: comment.id,
        author: comment.author.name,
        score: comment.score,
        created_utc: comment.created_utc,
        body: comment.body,
      })),
    };
    res.json(thread);
  } catch (error) {
    console.error('Reddit thread error:', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Reddit' });
  }
});

// Quora Search Endpoint (Using Google Search API)
app.get('/quora/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const searchQuery = `site:quora.com "${query}"`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}`;
    console.log('Fetching Quora search results from Google API:', url);

    const response = await axios.get(url);
    const items = response.data.items || [];

    const results = items.map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || '',
      answer_count: item.snippet.match(/\d+ Answers/i) ? parseInt(item.snippet.match(/\d+/)[0]) : 0, // Estimate answer count from snippet
    }));

    res.json(results);
  } catch (error) {
    console.error('Quora search error (Google API):', error.message);
    res.status(500).json({ error: 'Failed to fetch search results from Quora via Google API' });
  }
});

// Quora Thread Endpoint (Still using Puppeteer)
app.get('/quora/thread', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    await autoScroll(page);

    const thread = await page.evaluate(() => {
      const title = document.querySelector('h1')?.innerText || '';
      const answers = [];
      const answerElements = document.querySelectorAll('div.q-box > div > div > div > div > div > div > div > div > div > div:nth-child(2) > div > div > div > div > div > div > div');
      
      answerElements.forEach((element) => {
        const authorElement = element.querySelector('div > div > div > a > span > span');
        const author = authorElement ? authorElement.innerText : 'Anonymous';
        const answerTextElement = element.querySelector('div > div:nth-child(2) > div > div > span > span');
        const answerText = answerTextElement ? answerTextElement.innerText : '';

        if (answerText) {
          answers.push({
            author,
            body: answerText,
          });
        }
      });

      return {
        title,
        url: window.location.href,
        answers,
      };
    });

    await browser.close();
    res.json(thread);
  } catch (error) {
    console.error('Quora thread error:', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Quora' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
