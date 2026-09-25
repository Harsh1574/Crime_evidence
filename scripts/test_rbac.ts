
import axios from 'axios';
import FormData from 'form-data';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/lib/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.resolve(__dirname, 'rbac_log.txt');

// Config
const CONFIG_PATH = path.resolve(__dirname, '..', 'demo_config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const SECRET = process.env.JWT_SECRET || config.security?.jwt_secret || "crime-evidence-dev-secret-change-in-production";
const BASE_URL = 'http://localhost:3000/api/v1';

function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + '\n');
}

function error(msg: string) {
    console.error(msg);
    fs.appendFileSync(LOG_FILE, 'ERROR: ' + msg + '\n');
}

async function setupUsers() {
    log('Setting up test users...');

    const users = [
        { id: 'test-officer', username: 'test-officer', role: 'officer', email: 'officer@test.com' },
        { id: 'test-analyst', username: 'test-analyst', role: 'analyst', email: 'analyst@test.com' },
        { id: 'test-custodian', username: 'test-custodian', role: 'custodian', email: 'custodian@test.com' },
        { id: 'test-recipient-uuid', username: 'test-recipient', role: 'officer', email: 'recipient@test.com' }
    ];

    for (const u of users) {
        await prisma.user.upsert({
            where: { id: u.id },
            update: {},
            create: {
                id: u.id,
                username: u.username,
                email: u.email,
                fullName: `Test ${u.role}`,
                role: u.role,
                passwordHash: '$2a$10$dummyhash',
                isActive: true
            }
        });
    }
    log('Test users setup complete.\n');
}

async function testRole(role: string, shouldSucceed: boolean) {
    log(`\nTesting Role: ${role} (Should succeed: ${shouldSucceed})`);

    // Generate Token
    const token = jwt.sign({
        userId: `test-${role}`,
        username: `test-${role}`,
        role: role
    }, SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });

    let evidenceId: string | null = null;

    try {
        const form = new FormData();
        form.append('caseId', `TEST-${role.toUpperCase()}`);
        form.append('type', 'Physical');
        form.append('description', `Test evidence by ${role}`);
        form.append('location', 'Test Lab');
        form.append('collectionDate', new Date().toISOString());
        form.append('status', 'Collected');

        const res = await axios.post(`${BASE_URL}/evidence`, form, {
            headers: {
                Authorization: `Bearer ${token}`,
                ...(form as any).getHeaders()
            }
        });

        if (shouldSucceed) {
            log(`✅ Success: ${role} was able to register evidence.`);
            evidenceId = res.data.evidence.id;
        } else {
            error(`❌ FAILURE: ${role} WAS ABLE to register evidence (Should have been blocked).`);
        }
    } catch (err: any) {
        if (err.response) {
            if (err.response.status === 403) {
                if (!shouldSucceed) {
                    log(`✅ Success: ${role} was blocked (403 Forbidden).`);
                } else {
                    error(`❌ FAILURE: ${role} was blocked (403 Forbidden) but SHOULD have succeeded.`);
                    error('Response: ' + JSON.stringify(err.response.data));
                }
            } else {
                error(`⚠️ Unexpected error for ${role}: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
            }
        } else {
            error(`⚠️ Network error for ${role}: ${err.message}`);
        }
    }

    return evidenceId;
}

async function testTransfer(evidenceId: string) {
    log(`\nTesting Transfer for Evidence ID: ${evidenceId}`);
    const token = jwt.sign({
        userId: `test-officer`,
        username: `test-officer`,
        role: `officer`
    }, SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });

    // Create a dummy recipient
    const recipientId = "test-recipient-uuid";

    try {
        await axios.post(`${BASE_URL}/custody/evidence/${evidenceId}/transfer`, {
            toUserId: recipientId,
            reason: "Testing transfer permissions"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        log("✅ Transfer initiated (or verified permission).");
    } catch (err: any) {
        if (err.response) {
            if (err.response.status === 403) {
                error("❌ FAILURE: Transfer blocked by RBAC (403).");
            } else if (err.response.status === 404) {
                log("✅ Success: RBAC passed (got 404 for recipient/evidence as expected).");
            } else {
                log(`✅ Success: RBAC passed (got ${err.response.status}: ${err.response.data.error}).`);
            }
        } else {
            error(`⚠️ Transfer Network Error: ${err.message}`);
        }
    }
}

async function run() {
    // Clear log file
    fs.writeFileSync(LOG_FILE, '');

    await setupUsers();

    // 1. Officer -> Should Succeed
    const officerEvidenceId = await testRole('officer', true);

    // 2. Analyst -> Should Fail
    await testRole('analyst', false);

    // 3. Custodian -> Should Fail
    await testRole('custodian', false);

    if (officerEvidenceId) {
        await testTransfer(officerEvidenceId);
    } else {
        log("\nSkipping transfer test because Officer failed to register evidence.");
    }
}

run();
