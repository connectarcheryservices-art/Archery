-- Archery.Services — migration 014
-- Give jobs a real description, and publish the Product Manager posting.
--
-- The jobs table had only title/org/location/type/salary — no room for the
-- actual job description, so the careers page could list a role but not explain
-- it. This adds a description column and inserts the Product Manager posting the
-- owner provided verbatim. That posting is REAL, owner-authored content the owner
-- asked to publish — not invented data, so §1.1 is satisfied. No salary figure is
-- set, because the posting states none; inventing one would be fabrication.
--
-- Idempotent, forward-only (ADR-0002). Run after 013 with `node supabase/apply.js`.

alter table jobs add column if not exists description text default '';

-- Publish the Product Manager role exactly once (keyed on title+org).
insert into jobs (title, org, location, type, salary, description, active)
select
  'Product Manager',
  'Archery.Services',
  'Remote',
  'Internship / Full-Time',
  '',
  'Are you passionate about building impactful digital products from idea to execution? Do you enjoy solving real-world problems, working with cross-functional teams, and shaping product strategy?

Archery.Services is looking for a Product Manager to help design and scale the future of our platform.

WHAT YOU''LL DO
• Define product vision, roadmap, and strategy.
• Gather and prioritize user and business requirements.
• Work closely with engineering, design, and business teams.
• Create PRDs, user stories, wireframes, and product specifications.
• Analyze user feedback and product metrics to drive continuous improvement.
• Coordinate product releases and ensure timely delivery.

WHAT WE''RE LOOKING FOR
• Strong analytical and problem-solving skills.
• Excellent communication and stakeholder management.
• Basic understanding of UI/UX, software development, and Agile methodologies.
• Experience with product documentation and roadmap planning is a plus.
• Passion for innovation and building user-centric products.

WHY JOIN US
• Work on a fast-growing product with real-world impact.
• Collaborate with a highly driven and innovative team.
• Gain end-to-end product ownership and leadership experience.
• Opportunity to shape the future of sports technology.

Type: Internship / Full-Time (based on performance and availability).',
  true
where not exists (
  select 1 from jobs where lower(title)='product manager' and lower(org)='archery.services'
);
