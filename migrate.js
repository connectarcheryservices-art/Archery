// migrate.js — Seeds Neon DB from data.json (run once after schema.sql)
// Usage: DATABASE_URL=<neon_url> node migrate.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  Set DATABASE_URL before running migrate.js');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DATA_FILE = path.join(__dirname, 'data.json');

async function run() {
  const client = await pool.connect();
  try {
    console.log('🔗  Connected to Neon');

    let seed = {};
    if (fs.existsSync(DATA_FILE)) {
      seed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('📂  Loaded data.json for migration');
    } else {
      console.log('⚠️   No data.json — seeding defaults only');
    }

    await client.query('BEGIN');

    // products
    if (seed.products?.length) {
      for (const p of seed.products) {
        await client.query(
          `INSERT INTO products (id,name,brand,price,was,category,stock,active,img_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE
           SET name=$2,brand=$3,price=$4,was=$5,category=$6,stock=$7,active=$8,img_data=$9`,
          [p.id, p.name, p.brand||'', p.price||0, p.was||null, p.category||'', p.stock||0, p.active!==false, p.img_data||null]
        );
      }
      console.log(`  ✓  ${seed.products.length} products`);
    }

    // tournaments
    if (seed.tournaments?.length) {
      for (const t of seed.tournaments) {
        await client.query(
          `INSERT INTO tournaments (id,name,date,location,prize,slots,registered,status,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE
           SET name=$2,date=$3,location=$4,prize=$5,slots=$6,registered=$7,status=$8,active=$9`,
          [t.id, t.name, t.date||null, t.location||'', t.prize||0, t.slots||0, t.registered||0, t.status||'open', t.active!==false]
        );
      }
      console.log(`  ✓  ${seed.tournaments.length} tournaments`);
    }

    // athletes
    if (seed.athletes?.length) {
      for (const a of seed.athletes) {
        await client.query(
          `INSERT INTO athletes (id,name,state,discipline,rank,pb,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE
           SET name=$2,state=$3,discipline=$4,rank=$5,pb=$6,active=$7`,
          [a.id, a.name, a.state||'', a.discipline||'', a.rank||null, a.pb||null, a.active!==false]
        );
      }
      console.log(`  ✓  ${seed.athletes.length} athletes`);
    }

    // news
    if (seed.news?.length) {
      for (const n of seed.news) {
        await client.query(
          `INSERT INTO news (id,title,category,date,excerpt,active)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE
           SET title=$2,category=$3,date=$4,excerpt=$5,active=$6`,
          [n.id, n.title, n.category||'', n.date||null, n.excerpt||'', n.active!==false]
        );
      }
      console.log(`  ✓  ${seed.news.length} news items`);
    }

    // jobs
    if (seed.jobs?.length) {
      for (const j of seed.jobs) {
        await client.query(
          `INSERT INTO jobs (id,title,org,location,type,salary,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE
           SET title=$2,org=$3,location=$4,type=$5,salary=$6,active=$7`,
          [j.id, j.title, j.org||'', j.location||'', j.type||'', j.salary||'', j.active!==false]
        );
      }
      console.log(`  ✓  ${seed.jobs.length} jobs`);
    }

    // knowledge
    if (seed.knowledge?.length) {
      for (const k of seed.knowledge) {
        await client.query(
          `INSERT INTO knowledge (id,title,category,level,read_time,excerpt,published,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE
           SET title=$2,category=$3,level=$4,read_time=$5,excerpt=$6,published=$7,active=$8`,
          [k.id, k.title, k.category||'', k.level||'', k.readTime||'', k.excerpt||'', k.published!==false, k.active!==false]
        );
      }
      console.log(`  ✓  ${seed.knowledge.length} knowledge items`);
    }

    // profiles
    if (seed.profiles?.length) {
      for (const p of seed.profiles) {
        await client.query(
          `INSERT INTO profiles (id,handle,name,headline,location,discipline,bio,pb,rank,events,years,links,achievements,experience,certifications,verified,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO UPDATE
           SET handle=$2,name=$3,headline=$4,location=$5,discipline=$6,bio=$7,pb=$8,rank=$9,events=$10,years=$11,links=$12,achievements=$13,experience=$14,certifications=$15,verified=$16,active=$17`,
          [p.id, p.handle||String(p.id), p.name, p.headline||'', p.location||'', p.discipline||'', p.bio||'',
           p.pb||null, p.rank||null, p.events||0, p.years||0,
           JSON.stringify(p.links||[]), JSON.stringify(p.achievements||[]),
           JSON.stringify(p.experience||[]), JSON.stringify(p.certifications||[]),
           p.verified||false, p.active!==false]
        );
      }
      console.log(`  ✓  ${seed.profiles.length} profiles`);
    }

    // chats
    if (seed.chats?.length) {
      for (const c of seed.chats) {
        await client.query(
          `INSERT INTO chats (id,name,email,status,unread,updated_at,messages)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [c.id, c.name||'', c.email||'', c.status||'open', c.unread!==false, c.updatedAt||Date.now(), JSON.stringify(c.messages||[])]
        );
      }
      console.log(`  ✓  ${seed.chats.length} chats`);
    }

    // users (pass values are already scrypt salt:hash strings from file mode)
    if (seed.users?.length) {
      for (const u of seed.users) {
        await client.query(
          `INSERT INTO users (id,name,email,pass,created_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE
           SET name=$2,email=$3,pass=$4,created_at=$5`,
          [u.id, u.name||'', u.email, u.pass, u.createdAt||Date.now()]
        );
      }
      console.log(`  ✓  ${seed.users.length} users`);
    }

    // settings
    if (seed.settings) {
      await client.query(
        `INSERT INTO settings (id,data) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET data=$1`,
        [JSON.stringify(seed.settings)]
      );
      console.log('  ✓  settings');
    }

    // stats
    if (seed.stats) {
      await client.query(
        `INSERT INTO stats (id,data) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET data=$1`,
        [JSON.stringify(seed.stats)]
      );
      console.log('  ✓  stats');
    }

    await client.query('COMMIT');
    console.log('\n✅  Migration complete — all data is in Neon\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
