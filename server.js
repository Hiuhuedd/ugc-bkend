const express = require('express');
const snoowrap = require('snoowrap');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(express.json());
// CORS configuration
app.use(cors({
    origin: 'https://reddit-user-gen-content.netlify.app', // Allow only your Netlify frontend
    methods: ['GET', 'POST'], // Allow only GET and POST requests
    allowedHeaders: ['Content-Type'], // Allow specific headers
  }));
// Reddit API setup
const r = new snoowrap({
  userAgent: 'ugc-app/0.1 by your-username',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Google Search API setup
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// Browserless setup
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

// Helper function to auto-scroll pages (for Quora and Twitter)
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
    if (response.status !== 200) {
      throw new Error(`Google API request failed with status ${response.status}: ${response.statusText}`);
    }

    const items = response.data.items || [];
    const results = items.map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || '',
      answer_count: item.snippet.match(/\d+ Answers/i) ? parseInt(item.snippet.match(/\d+/)[0]) : 0,
    }));

    res.json(results);
  } catch (error) {
    console.error('Quora search error (Google API):', error.response ? error.response.data : error.message);
    res.status(500).json({ 
      error: 'Failed to fetch search results from Quora via Google API', 
      details: error.response ? error.response.data : error.message 
    });
  }
});

// Twitter Search Endpoint (Using Google Search API)
app.get('/twitter/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const searchQuery = `site:twitter.com ${query}`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}`;
    console.log('Fetching Twitter search results from Google API:', url);

    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(`Google API request failed with status ${response.status}: ${response.statusText}`);
    }

    const items = response.data.items || [];
    const results = items.map(item => {
      const urlMatch = item.link.match(/twitter\.com\/([^/]+)\/status/);
      const username = urlMatch ? urlMatch[1] : 'Unknown';
      const tweetIdMatch = item.link.match(/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : null;

      return {
        tweet_id: tweetId,
        title: item.title,
        url: item.link,
        snippet: item.snippet || '',
        username: username,
      };
    });

    res.json(results);
  } catch (error) {
    console.error('Twitter search error (Google API):', error.response ? error.response.data : error.message);
    res.status(500).json({ 
      error: 'Failed to fetch search results from Twitter via Google API', 
      details: error.response ? error.response.data : error.message 
    });
  }
});

// Quora Thread Endpoint (Using Browserless)
app.get('/quora/thread', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
    });
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
    console.error('Quora thread error (Browserless):', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Quora' });
  }
});

// Twitter Thread Endpoint (Using Browserless)
app.get('/twitter/thread', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await autoScroll(page);
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });

    const thread = await page.evaluate(() => {
      const tweetElement = document.querySelector('article[data-testid="tweet"]');
      const usernameElement = tweetElement?.querySelector('div[data-testid="User-Name"] a');
      const username = usernameElement?.innerText || 'Unknown';
      const tweetTextElement = tweetElement?.querySelector('div[data-testid="tweetText"]');
      const tweetText = tweetTextElement?.innerText || '';

      const replies = [];
      const replyElements = document.querySelectorAll('article[data-testid="tweet"]:not(:first-of-type)');
      replyElements.forEach((element) => {
        const replyUsernameElement = element.querySelector('div[data-testid="User-Name"] a');
        const replyUsername = replyUsernameElement?.innerText || 'Unknown';
        const replyTextElement = element.querySelector('div[data-testid="tweetText"]');
        const replyText = replyTextElement?.innerText || '';

        if (replyText) {
          replies.push({
            username: replyUsername,
            body: replyText,
          });
        }
      });

      return {
        username,
        tweet_text: tweetText,
        url: window.location.href,
        replies,
      };
    });

    await browser.close();
    res.json(thread);
  } catch (error) {
    console.error('Twitter thread error (Browserless):', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Twitter' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});