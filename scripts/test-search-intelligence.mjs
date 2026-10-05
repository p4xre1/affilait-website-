import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../functions/_shared/search-intelligence.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
const {
  analyzeQueryStructure,
  inferPageContentEvidence,
  isQuestionLikeHeading,
  normalizeQuery,
  tokenizeQuery,
} = await import(moduleUrl);

assert.equal(normalizeQuery('  Best—RUNNING Shoes?!  '), 'best running shoes');
assert.equal(normalizeQuery('The cafés near me'), 'the cafés near me');
assert.equal(normalizeQuery('Best running shoes. For beginners!'), 'best running shoes for beginners');
assert.equal(normalizeQuery('What is the best shoe for a child?'), 'what is the best shoe for a child');
assert.deepEqual(tokenizeQuery('What is the best shoe for a child?'), ['what', 'is', 'the', 'best', 'shoe', 'for', 'a', 'child']);
assert.notEqual(normalizeQuery('running shoe'), normalizeQuery('running shoes'), 'singular/plural forms stay distinct');
assert.notEqual(normalizeQuery('restaurant discount online'), normalizeQuery('online restaurant discount'), 'word order remains part of the normalized query');
assert.equal(normalizeQuery('wirless headphones'), 'wirless headphones', 'misspellings are not silently corrected');

const structured = analyzeQueryStructure('Best running shoes for beginners under $100');
assert.equal(structured.topic, 'running shoes');
assert.equal(structured.head, 'running shoes');
assert.deepEqual(structured.audience, ['beginners']);
assert.equal(structured.constraints[0].kind, 'price');
assert.equal(structured.constraints[0].unit, '$');
assert.ok(structured.modifiers.some(({ category, text }) => category === 'recommendation' && text === 'best'));
assert.ok(structured.modifiers.some(({ category, value }) => category === 'audience' && value === 'beginners'));
assert.equal(structured.intent.primary, 'commercial-investigation');
assert.equal(structured.funnelStage, 'consideration');
assert.equal(structured.expectedPageRole, 'buying-guide');
assert.equal(structured.expectedContentFormat, 'curated-recommendations');
assert.ok(structured.confidence > 0 && structured.confidence <= 1);
assert.equal(analyzeQueryStructure('').confidence, 0);
const boundedQuery = analyzeQueryStructure('long '.repeat(200));
assert.ok(boundedQuery.rawQuery.length <= 300);
assert.ok(boundedQuery.tokens.length <= 40);
assert.ok(structured.microIntent.includes('budget'));
assert.equal(structured.attributes.length, 0, 'A price ceiling is a constraint, not a content attribute.');
const decimalPrice = analyzeQueryStructure('waterproof boots under $99.50');
assert.equal(decimalPrice.topic, 'boots');
assert.ok(decimalPrice.attributes.includes('waterproof'));
assert.equal(decimalPrice.constraints.find(({ kind }) => kind === 'price').value, 'under 99.50');
assert.equal(decimalPrice.constraints[0].unit, '$');
assert.equal(structured.searchVolume, undefined);
assert.equal(structured.competition, undefined);

const firstOrder = analyzeQueryStructure('restaurant discount online');
const secondOrder = analyzeQueryStructure('online restaurant discount');
assert.equal(firstOrder.topic, 'restaurant');
assert.equal(secondOrder.topic, 'restaurant');
assert.deepEqual(firstOrder.context, ['online']);
assert.deepEqual(secondOrder.context, ['online']);
assert.notEqual(firstOrder.id, secondOrder.id);
assert.equal(firstOrder.intent.primary, 'commercial-investigation');

const compatibility = analyzeQueryStructure('email tools for WordPress');
assert.equal(compatibility.topic, 'email tools');
assert.ok(compatibility.entities.some(({ text, type }) => text === 'wordpress' && type === 'software-platform'));
assert.ok(compatibility.constraints.some(({ kind }) => kind === 'compatibility'));
const comparison = analyzeQueryStructure('Alpha vs Beta');
assert.ok(comparison.entities.some(({ text, type }) => text === 'alpha' && type === 'comparison-target'));
assert.ok(comparison.entities.some(({ text, type }) => text === 'beta' && type === 'comparison-target'));
assert.equal(comparison.expectedPageRole, 'comparison');

const local = analyzeQueryStructure('restaurants near me');
assert.equal(local.intent.primary, 'local');
assert.ok(local.location.includes('near me'));

const question = analyzeQueryStructure('How to choose the right shoe size?');
assert.equal(question.intent.primary, 'informational');
assert.ok(question.microIntent.includes('how-to'));
assert.equal(question.expectedContentFormat, 'step-by-step-guide');
assert.equal(question.source[0], 'manual');
assert.equal(analyzeQueryStructure('How to choose the right shoe size?', 'site-content-inferred').source[0], 'site-content-inferred');
assert.equal(isQuestionLikeHeading('What makes a useful page?'), true);
assert.equal(isQuestionLikeHeading('How to install the update'), true);
assert.equal(isQuestionLikeHeading('A clear page title'), false);

const pageEvidence = inferPageContentEvidence({
  url: 'https://example.com/guides/trail-shoes',
  title: 'Trail shoe fit and selection',
  description: 'A practical guide to choosing trail shoes.',
  htmlLang: 'en',
  headings: [
    { level: 1, text: 'Trail shoe fit and selection' },
    { level: 2, text: 'How do I choose trail shoes?' },
    { level: 2, text: 'What should a trail shoe fit feel like?' },
    { level: 4, text: 'This heading level is outside the evidence limit' },
  ],
});
assert.equal(pageEvidence.source, 'crawl');
assert.equal(pageEvidence.primaryTopic, 'Trail shoe fit and selection');
assert.equal(pageEvidence.topicConfidence, 0.8);
assert.equal(pageEvidence.pageRole.role, 'blog-article');
assert.equal(pageEvidence.questions.length, 2);
assert.equal(pageEvidence.questions[0].query.source[0], 'site-content-inferred');
assert.equal(pageEvidence.questions[0].query.intent.primary, 'informational');
assert.equal(pageEvidence.headingEvidence.length, 3);
assert.match(pageEvidence.note, /not observed search queries/i);

const nonEnglishEvidence = inferPageContentEvidence({
  url: 'https://example.com/fr/guide',
  title: 'Guide pratique',
  description: '',
  htmlLang: 'fr',
  headings: [{ level: 1, text: 'Guide pratique' }, { level: 2, text: 'Comment choisir ?' }],
});
assert.equal(nonEnglishEvidence.questions.length, 0);
assert.match(nonEnglishEvidence.note, /English query patterns were skipped/i);

const homeEvidence = inferPageContentEvidence({
  url: 'https://example.com/', title: 'Home', description: '', htmlLang: 'en', headings: [{ level: 1, text: 'Home' }],
});
assert.equal(homeEvidence.pageRole.role, 'homepage');

const boundedEvidence = inferPageContentEvidence({
  url: 'https://example.com/faq',
  title: 'Frequently asked questions',
  description: '',
  htmlLang: 'en',
  headings: Array.from({ length: 30 }, (_, index) => ({ level: 2, text: `What is question number ${index + 1}?` })),
});
assert.equal(boundedEvidence.headingEvidence.length, 18);
assert.equal(boundedEvidence.questions.length, 6);
assert.ok(boundedEvidence.headingEvidence.every(({ text }) => text.length <= 120));

console.log('Search intelligence tests passed: contextual query structure, modifier extraction, confidence inputs, intent labels, page roles, question evidence, language handling, and bounds.');
