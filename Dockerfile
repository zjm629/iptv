FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

RUN node -e "const fs=require('fs');let commit=process.env.APP_VERSION||'unknown';try{const head=fs.readFileSync('.git/HEAD','utf8').trim();if(head.startsWith('ref:')){const ref=head.slice(5).trim();if(fs.existsSync('.git/'+ref)){commit=fs.readFileSync('.git/'+ref,'utf8').trim().slice(0,7)}else if(fs.existsSync('.git/packed-refs')){const line=fs.readFileSync('.git/packed-refs','utf8').split(/\r?\n/).find((item)=>item.endsWith(' '+ref));if(line) commit=line.split(' ')[0].slice(0,7)}}else if(head){commit=head.slice(0,7)}}catch(e){}fs.writeFileSync('build-version.json',JSON.stringify({commit})+'\n');fs.rmSync('.git',{recursive:true,force:true})"

ENV NODE_ENV=production
ENV PORT=3080

EXPOSE 3080

CMD ["pnpm", "start"]
