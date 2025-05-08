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

// NewsAPI setup
const NEWS_API_KEY = process.env.NEWS_API_KEY;

// Helper function to auto-scroll pages (for Quora)
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
      headline: post.title,
      source: post.subreddit.display_name,
      author: post.author.name,
      score: post.score,
      comments: post.num_comments,
      date: new Date(post.created_utc * 1000).toISOString(),
      thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
      url: post.url,
      is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
      content_body: post.selftext || '',
    }));

    console.log('Reddit Search Sample Data (first result):', JSON.stringify(posts[0], null, 2));
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
      headline: post.title,
      source: post.subreddit.display_name,
      author: post.author.name,
      score: post.score,
      date: new Date(post.created_utc * 1000).toISOString(),
      content_body: post.selftext || '',
      thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
      url: post.url,
      is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
      comments: comments.map(comment => ({
        id: comment.id,
        author: comment.author.name,
        score: comment.score,
        date: new Date(comment.created_utc * 1000).toISOString(),
        content_body: comment.body,
      })),
    };

    console.log('Reddit Thread Sample Data:', JSON.stringify({
      post_id: thread.post_id,
      headline: thread.headline,
      source: thread.source,
      author: thread.author,
      date: thread.date,
      content_body: thread.content_body,
      thumbnail: thread.thumbnail,
      url: thread.url,
      first_comment: thread.comments[0]
    }, null, 2));

    res.json(thread);
  } catch (error) {
    console.error('Reddit thread error:', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Reddit' });
  }
});

// Quora Search Endpoint
app.get('/quora/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const searchQuery = `site:quora.com "${query}"`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}&num=10`;
    console.log('Fetching Quora search results from Google API:', url);

    const response = await axios.get(url);
    const items = response.data.items || [];

    const results = items.map(item => ({
      headline: item.title,
      url: item.link,
      content_body: item.snippet || '',
      source: 'Quora',
      author: item.pagemap?.metatags?.[0]?.['article:author'] || null,
      date: item.pagemap?.metatags?.[0]?.['article:published_time'] || null,
      thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || null,
      answer_count: item.snippet.match(/\d+ Answers/i) ? parseInt(item.snippet.match(/\d+/)[0]) : 0,
    }));

    console.log('Quora Search Sample Data (first result):', JSON.stringify(results[0], null, 2));
    res.json(results);
  } catch (error) {
    console.error('Quora search error (Google API):', error.message);
    res.status(500).json({ error: 'Failed to fetch search results from Quora via Google API' });
  }
});

// Quora Thread Endpoint
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
            content_body: answerText,
            date: null,
          });
        }
      });

      return {
        headline: title,
        url: window.location.href,
        source: 'Quora',
        author: null,
        date: null,
        thumbnail: null,
        content_body: '',
        answers,
      };
    });

    console.log('Quora Thread Sample Data:', JSON.stringify({
      headline: thread.headline,
      source: thread.source,
      url: thread.url,
      first_answer: thread.answers[0]
    }, null, 2));

    await browser.close();
    res.json(thread);
  } catch (error) {
    console.error('Quora thread error:', error);
    res.status(500).json({ error: 'Failed to fetch thread details from Quora' });
  }
});

// News Agency Search Endpoint
app.get('/news/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    // Fetch from NewsAPI
    const newsApiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=2025-04-16&sortBy=publishedAt&sources=bbc-news,cnn,forbes,bloomberg,usa-today,the-new-york-times,reuters,the-washington-post,al-jazeera-english,national-public-radio-npr,time,axios,voa-news,cbs-news,fortune&pageSize=15&apiKey=${NEWS_API_KEY}`;
    console.log('Fetching news search results from NewsAPI:', newsApiUrl);

    const response = await axios.get(newsApiUrl);
    console.log('NewsAPI Raw Response:', JSON.stringify(response.data, null, 2));

    const items = response.data.articles || [];

    const newsApiResults = items.map(item => ({
      headline: item.title || '',
      url: item.url || '',
      content_body: (item.description || item.content || '').substring(0, 200) + ((item.description || item.content || '').length > 200 ? '...' : ''),
      source: item.source.name || new URL(item.url).hostname.replace('www.', ''),
      author: item.author || 'Unknown',
      date: item.publishedAt || null,
      thumbnail: item.urlToImage || null,
    }));

    // Create DWN and AJ Center results by copying from CNN and BBC
    let dwnResult = null;
    let ajResult = null;
    const fallbackSources = ['Reuters', 'Bloomberg', 'CBS News'];

    // Find CNN article for DWN
    const cnnArticle = newsApiResults.find(result => result.source === 'CNN');
    if (cnnArticle) {
      dwnResult = { ...cnnArticle, source: 'digitalworldwidenews.com' };
    } else {
      // Fallback to another source
      for (const fallback of fallbackSources) {
        const fallbackArticle = newsApiResults.find(result => result.source === fallback);
        if (fallbackArticle) {
          dwnResult = { ...fallbackArticle, source: 'digitalworldwidenews.com' };
          break;
        }
      }
    }

    // Find BBC article for AJ Center
    const bbcArticle = newsApiResults.find(result => result.source === 'BBC News');
    if (bbcArticle) {
      ajResult = { ...bbcArticle, source: 'theajcenter.com' };
    } else {
      // Fallback to another source
      for (const fallback of fallbackSources) {
        const fallbackArticle = newsApiResults.find(result => result.source === fallback);
        if (fallbackArticle) {
          ajResult = { ...fallbackArticle, source: 'theajcenter.com' };
          break;
        }
      }
    }

    // If no articles found for DWN or AJ Center, create placeholders
    if (!dwnResult) {
      dwnResult = {
        headline: `No ${query} articles found`,
        url: 'https://www.digitalworldwidenews.com/',
        content_body: `Visit https://www.digitalworldwidenews.com/ for latest ${query} news.`,
        source: 'digitalworldwidenews.com',
        author: 'Unknown',
        date: null,
        thumbnail: null,
      };
    }
    if (!ajResult) {
      ajResult = {
        headline: `No ${query} articles found`,
        url: 'https://www.theajcenter.com/',
        content_body: `Visit https://www.theajcenter.com/ for latest ${query} news.`,
        source: 'theajcenter.com',
        author: 'Unknown',
        date: null,
        thumbnail: null,
      };
    }

    // Combine results, prioritize DWN and AJ Center
    const allResults = [dwnResult, ajResult, ...newsApiResults];

    // Deduplicate by source, limit to 15 unique sources
    const uniqueSources = new Set();
    const filteredResults = [];
    for (const result of allResults) {
      if (!uniqueSources.has(result.source) && uniqueSources.size < 15) {
        uniqueSources.add(result.source);
        filteredResults.push(result);
      }
    }

    console.log('News Search Sample Data (first result):', JSON.stringify(filteredResults[0], null, 2));
    console.log('Total unique sources:', uniqueSources.size);
    res.json(filteredResults);
  } catch (error) {
    console.error('News search error:', error.message);
    res.status(500).json({ error: 'Failed to fetch search results from news agencies' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});