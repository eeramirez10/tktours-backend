INSERT INTO "Country" (id, code, name, "updatedAt") VALUES ('00000000-0000-4000-8000-000000000001', 'CA', 'Canadá', now());
INSERT INTO "Program" (id, "countryId", "familyId", name, slug, "updatedAt")
SELECT '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', id, 'Shared camp', 'shared-camp', now() FROM "ProductFamily" WHERE key='CAMP';
INSERT INTO "ProgramRule" ("programId", "quoteMode", "minWeeks", "maxWeeks", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000002','WEEK',2,2,now());
INSERT INTO "Resource" (id, "countryId", "familyId", "programId", type, title, year, "seasonKeys", "shareFrom", "shareUntil", "validFrom", "validUntil", "updatedAt")
SELECT '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', id, '00000000-0000-4000-8000-000000000002', 'BROCHURE', 'CAD BLI 2027', 2027, ARRAY['SUMMER']::"SeasonKey"[], '2027-01-01', '2027-08-31', '2027-07-04', '2027-08-08', now() FROM "ProductFamily" WHERE key='CAMP';
INSERT INTO "ResourceVersion" (id, "resourceId", "versionNumber", "fileUrl", "fileName", "storageProvider", "sourceType", "isCurrent") VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003',1,'https://example.com/bli.pdf','bli.pdf','EXTERNAL','EXTERNAL_LINK',true);
INSERT INTO "Contact" (id,"firstName","updatedAt") VALUES ('00000000-0000-4000-8000-000000000005','Preserved',now());
INSERT INTO "Conversation" (id, "contactId", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005',now());
INSERT INTO "Message" (id,"conversationId", direction,text) VALUES ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000006','INBOUND','Existing conversation remains');
