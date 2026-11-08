# Courtney

Women's college basketball schedule maker. Pick your teams, get one schedule, must-watch games, rankings, and calendar feeds.

## How it works

Teams, schedules, ratings and players to watch all come from public box scores. People's team picks save in their own browser (and in the page link); nothing is stored on a server.
`npm run build` downloads the current season's schedule and last season's box scores (ESPN data published by the open-source sportsdataverse/wehoop project), computes schedule-adjusted team ratings, and writes:

- `public/index.html`: the app, with the data baked in
- `public/cal/<team id>.ics`: one subscribable calendar per Division I team

Every Vercel deploy rebuilds the data, so redeploying refreshes times, scores and rankings.

## Deploy
1. Push this folder to a GitHub repo.
2. On vercel.com, choose Add New > Project and import the repo. Settings come from vercel.json.

## Keep it fresh
In Vercel, create a Deploy Hook (Project > Settings > Git > Deploy Hooks) and call it on a schedule (daily is plenty) to refresh the data.

## Change the design
Edit `page.html`. `__DATA__` is replaced at build time.
