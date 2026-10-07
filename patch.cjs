const fs = require('fs');
let text = fs.readFileSync('server/db/schema.ts', 'utf-8');
text = text.replace(
`export const lyrics = sqliteTable('lyrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  lrcPath: text('lrc_path').notNull(),
});`,
`export const lyrics = sqliteTable('lyrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  lrcPath: text('lrc_path'),
  elrcPath: text('elrc_path'),
});`
);
fs.writeFileSync('server/db/schema.ts', text);
