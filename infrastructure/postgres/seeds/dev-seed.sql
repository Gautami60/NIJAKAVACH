-- ==============================================================================
-- NIJAKAVACH Development Seed Data
-- ==============================================================================

-- 1. SEED SOURCES & CAPABILITIES (sources schema)

INSERT INTO sources.sources (
    id, name, slug, category, website_url, access_method, operational_status, rate_limit_rpm, description
) VALUES 
(
    '00000000-0000-0000-0001-000000000001',
    'India B2B Contact Directory Alpha',
    'india-b2b-alpha',
    'PUBLIC_DIRECTORY',
    'https://directory-alpha.demo.local',
    'HTTP_WEBFORM',
    'ACTIVE',
    30,
    'Publicly indexed corporate contact and professional directory in India.'
),
(
    '00000000-0000-0000-0001-000000000002',
    'National Yellow Pages India Beta',
    'national-yp-beta',
    'LEAD_AGGREGATOR',
    'https://yellowpages-beta.demo.local',
    'EMAIL_NOTICE',
    'ACTIVE',
    10,
    'B2B sales lead generation portal aggregating public phone numbers.'
),
(
    '00000000-0000-0000-0001-000000000003',
    'FastDial Indian Business Directory',
    'fastdial-in',
    'PUBLIC_DIRECTORY',
    'https://fastdial.demo.local',
    'REST_API',
    'ACTIVE',
    60,
    'Business telephone listing portal supporting automated opt-out API.'
),
(
    '00000000-0000-0000-0001-000000000004',
    'CityInfo Business Listings',
    'cityinfo-listings',
    'PEOPLE_SEARCH',
    'GRIEVANCE_OFFICER',
    'ACTIVE',
    5,
    'Local merchant and resident contact aggregator with statutory grievance cell.'
)
ON CONFLICT (slug) DO NOTHING;

-- Seed capabilities for sources
INSERT INTO sources.source_capabilities (
    id, source_id, capability, supported_identifiers, requires_auth_proof, estimated_removal_days
) VALUES
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000001',
    'SEARCHABLE',
    ARRAY['PHONE_NUMBER', 'EMAIL_ADDRESS'],
    FALSE,
    NULL
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000001',
    'WEBFORM_OPT_OUT',
    ARRAY['PHONE_NUMBER', 'EMAIL_ADDRESS'],
    TRUE,
    7
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000002',
    'SEARCHABLE',
    ARRAY['PHONE_NUMBER'],
    FALSE,
    NULL
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000002',
    'EMAIL_NOTICE_REMOVAL',
    ARRAY['PHONE_NUMBER'],
    TRUE,
    14
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000003',
    'REST_API_REMOVAL',
    ARRAY['PHONE_NUMBER', 'EMAIL_ADDRESS'],
    TRUE,
    3
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000004',
    'GRIEVANCE_OFFICER_REMOVAL',
    ARRAY['PHONE_NUMBER', 'EMAIL_ADDRESS'],
    TRUE,
    30
)
ON CONFLICT DO NOTHING;

-- Seed source policies
INSERT INTO sources.source_policies (
    id, source_id, statutory_framework, grievance_officer_email, postal_address, policy_version, terms_url
) VALUES
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000001',
    'DPDP_ACT_2023',
    'grievance@directory-alpha.demo.local',
    'Plot 42, Electronics City, Bengaluru, Karnataka 560100',
    '2024-V1',
    'https://directory-alpha.demo.local/privacy'
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000002',
    'DPDP_ACT_2023',
    'nodal@yellowpages-beta.demo.local',
    'Tower B, Cyber Hub, Gurugram, Haryana 122002',
    '2024-V2',
    'https://yellowpages-beta.demo.local/terms'
),
(
    gen_random_uuid(),
    '00000000-0000-0000-0001-000000000004',
    'DPDP_ACT_2023',
    'compliance@cityinfo.demo.local',
    'Shivaji Nagar, Pune, Maharashtra 411005',
    '2024-V1',
    'https://cityinfo.demo.local/grievance'
)
ON CONFLICT DO NOTHING;
