# Zite profile recovery audit — 2026-09-16

Read-only audit; no production records changed.

## Findings

Latest live check: 239 Users rows; 36 app sign-in identities have no exact normalized-email match in Users. Both queries reported no further pages. This is a mismatch count, not proof of 36 deleted profiles or 36 failed login attempts.

Searched saved Users, Guides, Zite_Users, _MigrationArchive and _MigrationArchiveChunks JSONL files under docs/migration-analysis/runs. No full Users profile with the exact email was found for any of these 36 identities. The original 32 have archived Zite Users identities (name/email/auth identity only). Four have Jigyasa registration records and one has a TagMango sync log; these do not establish original profile IDs, approval status, guide assignment or complete history.

The cutover Zite manifest explicitly has tombstonesIncluded:false. Deleted rows from before export are not recoverable from that snapshot. No exposed Zite connector operation supports undeleting a row or supplying a chosen original record ID on creation. Native restore availability remains unverified; ask Zite support for recovery of original Users rows and relationships before recreating anything.

## Per-account evidence

| Name | Email | Saved evidence | Full profile ready to restore? |
|---|---|---|---|
| testing last | yavoras913@devlug.com | Sign-in identity only | No |
| Sahasranama Das | sandeshbhopale16@gmail.com | Sign-in identity only | No |
| test service | denis49579@indevgo.com | Sign-in identity only | No |
| test serv | wotih35104@3dkai.com | Sign-in identity only | No |
| SATYAM VISHWAKARMA | satyamvishwakarma151@gmail.com | Sign-in identity only | No |
| Kartikraj Nadar | kartikrajgeorge906@gmail.com | Sign-in identity only | No |
| Divyansh Rathore | rathoredev021@gmail.com | Sign-in identity only | No |
| aman verma madhvan | verma.madhvan.verma@gmail.com | Sign-in identity only | No |
| test fin | verikok915@flosek.com | Sign-in identity only | No |
| testing now | lelon43852@indevgo.com | Sign-in identity only | No |
| Samarth Charhate | charhatevishal1975@gmail.com | Sign-in identity + Jigyasa registration | No |
| Shrikant Walunjakar | shrikantwalunjakar108@gmail.com | Sign-in identity only | No |
| test test | marokay823@isfew.com | Sign-in identity only | No |
| Gaurmandal Das | gmndasa@gmail.com | Sign-in identity only | No |
| Urukrama Gauranga Dasa | umeshpattar108@gmail.com | Sign-in identity only | No |
| Gopal Rastogi | gopalrastogi.mmmec@gmail.com | Sign-in identity only | No |
| Folk Powai | folk.powai@gmail.com | Sign-in identity + Jigyasa registration | No |
| test final | gapoy14544@soco7.com | Sign-in identity only | No |
| testtest | jabak61889@soco7.com | Sign-in identity only | No |
| guidetest | kenihob446@soco7.com | Sign-in identity only | No |
| Gaura Hari Dasa | gauraharidasa1010@gmail.com | Sign-in identity only | No |
| test 1 | nemapet983@agoalz.com | Sign-in identity only | No |
| hi test | wiyomam702@algarr.com | Sign-in identity only | No |
| testing | sasece2711@cosdas.com | Sign-in identity only | No |
| Adarsh Kumar | adarshkumarakash4066@gmail.com | Sign-in identity + Jigyasa registration | No |
| Rakesh Sharma | rakesh34sharma72@gmail.com | Sign-in identity + TagMango sync log | No |
| Madhav Mittal | madhavkrishnan381@gmail.com | Sign-in identity only | No |
| Kimay Bhargawe | kimaybhargawe29@gmail.com | Sign-in identity only | No |
| S | sahil.bharat.negi@gmail.com | Sign-in identity only | No |
| MAYANK GOEL | f2014768p@alumni.bits-pilani.ac.in | Sign-in identity only | No |
| Adarsh Singh | singhadarsh0016@gmail.com | Sign-in identity only | No |
| Aayush Kakadiya | aayushsince2004@gmail.com | Sign-in identity + Jigyasa registration | No |
| Barigela sai | neopinuse@gmail.com | Not found in inspected exports; later record observed in this conversation | No |
| Sudhakar Surakasi | sudhakar.surakasi99@gmail.com | Not found in inspected exports; later record observed in this conversation | No |
| Mukul Maurya | goldteam693@gmail.com | Not found in inspected exports; later record observed in this conversation | No |
| Rakesh Sharma | rakesh1998sharma01@gmail.com | Not found in inspected exports; later record observed in this conversation | No |

## Known newer record IDs from earlier live checks

| Email | Original Users record ID |
|---|---|
| sudhakar.surakasi99@gmail.com | dc6876e7-4af2-4a0f-9a24-637e16ded646 |
| goldteam693@gmail.com | eb7c5d1f-1065-478c-ad23-917677003d30 |
| rakesh1998sharma01@gmail.com | 3a3277cd-8da8-41a8-a8eb-655f918c45a0 |
| neopinuse@gmail.com | fd87f334-2d4c-4010-98a0-c6cf237dd9d5 |

These IDs identify recovery targets, not complete recovery payloads. The neopinuse record previously had no member User ID or status.

## Sai's original profile

barigelasaiii@gmail.com is a separate email, with original Users ID 0035c7ef-b95a-474c-a702-2cbeb3ed7abf and USER-203. Its full original profile is present in production-cutover/zite/tables/Users.jsonl, line 1. It was also verified live in the preceding investigation. Do not merge it with neopinuse@gmail.com without confirmation of ownership.

## Next recovery step

Ask Zite support whether the missing Users records and original linked relationships can be restored from deleted records or a pre-deletion database backup in base 1ab8f516ea1301be, app u91plgmzcu. Request original record IDs, deletion timestamps and affected relationships. Do not treat an auth identity as an approved profile. If originals cannot be recovered, recreation requires verified identity, guide and status and is not equivalent to restoring historical data.

## Evidence locations

- docs/migration-analysis/runs/20260910T174452Z/production-cutover/zite/manifest.json — tombstonesIncluded false.
- docs/migration-analysis/runs/20260910T174452Z/production-cutover/zite/tables/Zite_Users.jsonl — original 32 identity records.
- docs/migration-analysis/runs/20260910T174452Z/repair-rehearsal-20260911T103847Z/firestore/tables/_MigrationArchive.jsonl — archived identity and supplemental registration/log records; sourceTable distinguishes them from Users.

