# Review follow-up (not final acceptance)
Source: ../visit-writer/review-current.json; preserve original findings.
Finding 6: storage id is now server-generated; eventId uniqueness is (vendorId,liveId,versionId,visitorId,eventId). Real DB proves same event key in two tenants creates independent rows and each replays its own timestamp. Wrong-scope visitor still rejects.
Finding 7: writer uses FOR NO KEY UPDATE. Existing concurrent retry test passes. A dedicated overlapping FK-insert test remains unexecuted.
Finding 8: FK ON UPDATE NO ACTION matches immutable rows; TRUNCATE raises 23514 and real DB proves both rows remain. New trigger pins search_path and UTC and revokes PUBLIC/API execute. Initial UTC omission failed the guard inventory test, fixed without changing assertions; receipt preserved.
Final DB snapshot 270fce88085753d4027c7e8cf279d567ebbb2ebc86d39a82e66ab33049ec2476 passes 124 checks/98 migrations/cleanup. Targeted30/lint/tsc receipts refer to c93b433f9b01900a564aa424230ec79463974441c23f02a73e5ade33770c8f88; only SQL UTC setting changed afterward, tested in final DB run. No TS/test source changed afterward.
Other findings (precision, coverage, lifecycle replay, cleanup/concurrency) remain open. Independent re-review NOT_RUN. No WP acceptance claim.
