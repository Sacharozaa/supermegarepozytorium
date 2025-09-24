import { createServer } from 'node:http';

// Create a HTTP server
const server = createServer((req, res) => {
    const reqest_url = new URL(`http://${host}:${port}${req.url}`)

  console.log(`Reqest: ${req.method} ${reqest_url.pathname}`);

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('hello world!');
});

const port = 8000;
const host = "localhost";

// Start the server
server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
});