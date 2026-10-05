const form = document.querySelector('#site-audit-form');
  const urlInput = document.querySelector('#site-audit-url');
  const permissionInput = document.querySelector('#site-audit-permission');
  const submitButton = document.querySelector('#site-audit-submit');
  const statusBox = document.querySelector('#site-audit-status');
  const progress = document.querySelector('#site-audit-progress');
  const results = document.querySelector('#site-audit-results');

  function setStatus(message, isError = false) {
    statusBox.textContent = message;
    statusBox.classList.toggle('audit-status--error', isError);
    statusBox.hidden = !message;
  }

  async function postScan(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (typeof payload.scanId === 'string') headers['X-Scan-ID'] = payload.scanId;
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, permission: permissionInput.checked }),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The scan service returned an unreadable response. Please try again.');
    }
    if (!response.ok) throw new Error(data?.error || 'The scan could not be completed. Please try again.');
    return data;
  }

  function pathLabel(value) {
    try {
      return new URL(value).pathname || '/';
    } catch {
      return '/';
    }
  }

  function groupDuplicates(pages, key) {
    const groups = new Map();
    for (const page of pages) {
      const value = typeof page[key] === 'string' ? page[key].trim().toLowerCase().replace(/\s+/g, ' ') : '';
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), page.url]);
    }
    const duplicatePages = new Set();
    const duplicateGroups = [];
    for (const urls of groups.values()) {
      if (urls.length > 1) {
        urls.forEach((url) => duplicatePages.add(url));
        duplicateGroups.push(urls);
      }
    }
    return { duplicatePages, duplicateGroups };
  }

  function createFindings(report) {
    const issueMap = new Map();
    let earned = 0;
    let possible = 0;
    const titleDuplicates = groupDuplicates(report.pages, 'title');
    const descriptionDuplicates = groupDuplicates(report.pages, 'description');

    function addCheck({ id, passed, weight, severity, title, explanation, action, url }) {
      possible += weight;
      if (passed) {
        earned += weight;
        return;
      }
      let issue = issueMap.get(id);
      if (!issue) {
        issue = { id, severity, title, explanation, action, count: 0, paths: [] };
        issueMap.set(id, issue);
      }
      issue.count += 1;
      if (url && issue.paths.length < 4) issue.paths.push(pathLabel(url));
    }

    for (const page of report.pages) {
      if (page.status === null) {
        addCheck({
          id: 'unreachable', passed: false, weight: 8, severity: 'critical',
          title: 'Page could not be checked', explanation: page.error || 'The audit service could not read this page.',
          action: 'Check that the page is publicly available, loads without a sign-in, and does not block automated requests.', url: page.url,
        });
        continue;
      }
      addCheck({
        id: 'http-status', passed: page.status >= 200 && page.status < 300, weight: 3, severity: 'critical',
        title: 'Page response is not successful', explanation: `This URL returned HTTP ${page.status}.`,
        action: 'Check the URL, server response, redirects, and any broken links pointing to this page.', url: page.url,
      });
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(page.contentType || '');
      addCheck({
        id: 'html-response', passed: isHtml, weight: 3, severity: 'warning',
        title: 'URL does not return an HTML page', explanation: 'The sitemap URL did not return a standard HTML document.',
        action: 'Remove non-page URLs from the sitemap or make sure this route returns the intended page.', url: page.url,
      });
      if (!isHtml) continue;

      addCheck({
        id: 'https', passed: page.isHttps === true, weight: 2, severity: 'warning',
        title: 'Page does not finish on HTTPS', explanation: 'The final page address uses an unencrypted HTTP connection.',
        action: 'Enable HTTPS and redirect public HTTP versions to the secure URL.', url: page.url,
      });
      addCheck({
        id: 'title-missing', passed: Boolean(page.title), weight: 2, severity: 'warning',
        title: 'Page title is missing', explanation: 'A descriptive HTML title helps people and search engines understand the page.',
        action: 'Add a unique, accurate title that describes this page’s main subject.', url: page.url,
      });
      addCheck({
        id: 'title-length', passed: Boolean(page.title && page.title.length >= 15 && page.title.length <= 70), weight: 1, severity: 'info',
        title: 'Page title may need editing', explanation: `The title is ${page.title?.length || 0} characters; very short or long titles can be hard to scan in search results.`,
        action: 'Review the title for clarity and remove unnecessary repetition. The length range is a heuristic, not a Google rule.', url: page.url,
      });
      addCheck({
        id: 'description-missing', passed: Boolean(page.description), weight: 2, severity: 'warning',
        title: 'Meta description is missing', explanation: 'This page has no meta description in its HTML.',
        action: 'Write an accurate summary of the page. Search engines may still choose a different snippet.', url: page.url,
      });
      addCheck({
        id: 'description-length', passed: Boolean(page.description && page.description.length >= 50 && page.description.length <= 180), weight: 1, severity: 'info',
        title: 'Meta description may need editing', explanation: `The description is ${page.description?.length || 0} characters; this is a readability heuristic, not a ranking rule.`,
        action: 'Make the summary specific and useful, and avoid repeating the title verbatim.', url: page.url,
      });
      addCheck({
        id: 'h1-count', passed: page.h1Count === 1, weight: 2, severity: 'warning',
        title: page.h1Count === 0 ? 'Main heading is missing' : 'Page has more than one main heading',
        explanation: `The scanner found ${page.h1Count} H1 headings on this page.`,
        action: 'Use one clear primary heading for the page, then organize sections with lower-level headings.', url: page.url,
      });
      addCheck({
        id: 'canonical', passed: Boolean(page.canonical && page.canonicalSameSite), weight: 2, severity: 'warning',
        title: 'Canonical URL is missing or off-site', explanation: page.canonical ? 'The canonical link points to a different host or could not be parsed.' : 'No canonical link was found.',
        action: 'Add a canonical URL that points to the preferred version of this page on the same website.', url: page.url,
      });
      addCheck({
        id: 'viewport', passed: page.hasViewport === true, weight: 1, severity: 'warning',
        title: 'Mobile viewport declaration is missing', explanation: 'The page does not declare a viewport meta tag.',
        action: 'Add a responsive viewport meta tag and verify the page on a mobile screen.', url: page.url,
      });
      addCheck({
        id: 'html-language', passed: Boolean(page.htmlLang), weight: 1, severity: 'info',
        title: 'Document language is missing', explanation: 'The opening HTML element has no language value.',
        action: 'Set the document language, for example lang="en", to help browsers and assistive technologies.', url: page.url,
      });
      addCheck({
        id: 'noindex', passed: page.noindex !== true, weight: 2, severity: 'warning',
        title: 'Page asks search engines not to index it', explanation: 'A robots directive or response header contains noindex.',
        action: 'If this page should appear in search, review the robots meta tag and X-Robots-Tag header. Keep noindex where it is intentional.', url: page.url,
      });
      if ((page.imageCount || 0) > 0) {
        addCheck({
          id: 'image-alt', passed: (page.imagesMissingAlt || 0) === 0, weight: 1, severity: 'info',
          title: 'Some images lack alt attributes', explanation: `The scan found ${page.imagesMissingAlt} image${page.imagesMissingAlt === 1 ? '' : 's'} without an alt attribute out of ${page.imageCount}.`,
          action: 'Add concise alt text for informative images. Use an empty alt attribute for purely decorative images.', url: page.url,
        });
      }
      if ((page.jsonLdBlockCount || 0) > 0) {
        addCheck({
          id: 'jsonld-syntax', passed: (page.invalidJsonLdCount || 0) === 0, weight: 2, severity: 'warning',
          title: 'JSON-LD contains invalid JSON syntax',
          explanation: 'At least one structured-data block on this page could not be parsed as JSON.',
          action: 'Fix the JSON syntax, then validate the schema separately. This scan does not check Schema.org properties or rich-result eligibility, and structured data does not guarantee rankings or AI-search inclusion.',
          url: page.url,
        });
      }
      addCheck({
        id: 'duplicate-title', passed: !titleDuplicates.duplicatePages.has(page.url), weight: 2, severity: 'warning',
        title: 'Page title is duplicated', explanation: `This title is shared by ${titleDuplicates.duplicateGroups.find((group) => group.includes(page.url))?.length || 2} scanned pages.`,
        action: 'Give each indexable page a distinct title that reflects its own content.', url: page.url,
      });
      addCheck({
        id: 'duplicate-description', passed: !descriptionDuplicates.duplicatePages.has(page.url), weight: 1, severity: 'info',
        title: 'Meta description is duplicated', explanation: `This description is shared by ${descriptionDuplicates.duplicateGroups.find((group) => group.includes(page.url))?.length || 2} scanned pages.`,
        action: 'Write page-specific summaries instead of reusing the same description across the site.', url: page.url,
      });
    }

    possible += 2;
    if (report.sitemapFound) earned += 2;
    else {
      issueMap.set('sitemap', {
        id: 'sitemap', severity: 'warning', title: 'XML sitemap was not found',
        explanation: 'The audit did not find a readable sitemap through robots.txt or at /sitemap.xml.',
        action: 'Publish an XML sitemap and reference its public URL from robots.txt. Then submit it in Search Console if you use that service.',
        count: 1, paths: [],
      });
    }

    const findings = [...issueMap.values()].sort((a, b) => {
      const priority = { critical: 0, warning: 1, info: 2 };
      return priority[a.severity] - priority[b.severity] || b.count - a.count || a.title.localeCompare(b.title);
    });
    return {
      score: possible > 0 ? Math.round((earned / possible) * 100) : 0,
      possible,
      earned,
      findings,
      duplicateTitleGroups: titleDuplicates.duplicateGroups.length,
      duplicateDescriptionGroups: descriptionDuplicates.duplicateGroups.length,
    };
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderPageSpeed(pageSpeed, submittedUrl) {
    const scoresBox = document.querySelector('#pagespeed-scores');
    const metricsBox = document.querySelector('#pagespeed-metrics');
    const errorBox = document.querySelector('#pagespeed-error');
    const issuesBox = document.querySelector('#pagespeed-issues');
    const issuesList = document.querySelector('#pagespeed-issues-list');
    const targetLabel = document.querySelector('#pagespeed-target');
    scoresBox.replaceChildren();
    metricsBox.replaceChildren();
    issuesList.replaceChildren();
    targetLabel.textContent = pathLabel(submittedUrl);
    errorBox.hidden = true;
    issuesBox.hidden = true;

    if (pageSpeed?.error) {
      errorBox.textContent = pageSpeed.error;
      errorBox.hidden = false;
    }
    for (const item of pageSpeed?.scores || []) {
      const card = makeElement('div', 'pagespeed-score-card');
      card.append(makeElement('span', 'pagespeed-score-card__label', item.label));
      card.append(makeElement('strong', 'pagespeed-score-card__value', `${item.score}`));
      card.append(makeElement('span', 'pagespeed-score-card__scale', 'out of 100'));
      scoresBox.append(card);
    }
    if (!pageSpeed?.scores?.length && !pageSpeed?.error) {
      errorBox.textContent = 'No Lighthouse category scores were returned for this URL.';
      errorBox.hidden = false;
    }
    for (const metric of pageSpeed?.metrics || []) {
      const item = makeElement('div', 'pagespeed-metric');
      item.append(makeElement('span', '', metric.label));
      item.append(makeElement('strong', '', metric.value));
      metricsBox.append(item);
    }
    for (const issue of pageSpeed?.issues || []) {
      const item = makeElement('li', 'pagespeed-issue');
      item.append(makeElement('span', 'audit-severity audit-severity--info', issue.category));
      item.append(makeElement('strong', '', issue.title));
      if (issue.displayValue) item.append(makeElement('span', 'pagespeed-issue__value', issue.displayValue));
      if (issue.guidance) item.append(makeElement('p', '', issue.guidance));
      issuesList.append(item);
    }
    issuesBox.hidden = !(pageSpeed?.issues?.length);
  }

  function renderFindings(findings) {
    const container = document.querySelector('#audit-findings-list');
    const countLabel = document.querySelector('#audit-finding-count');
    container.replaceChildren();
    countLabel.textContent = findings.length ? `${findings.length} issue types` : 'No priority issues';
    if (!findings.length) {
      container.append(makeElement('p', 'audit-empty-state', 'No issues were found in the checks available for this scan. Keep reviewing important pages as your site changes.'));
      return;
    }
    for (const finding of findings) {
      const article = makeElement('article', `audit-finding audit-finding--${finding.severity}`);
      const header = makeElement('div', 'audit-finding__header');
      header.append(makeElement('span', `audit-severity audit-severity--${finding.severity}`, finding.severity));
      header.append(makeElement('span', 'audit-finding__count', `${finding.count} page${finding.count === 1 ? '' : 's'}`));
      article.append(header);
      article.append(makeElement('h4', '', finding.title));
      article.append(makeElement('p', 'audit-finding__explanation', finding.explanation));
      const action = makeElement('p', 'audit-finding__action');
      action.append(makeElement('strong', '', 'Suggested next step: '));
      action.append(document.createTextNode(finding.action));
      article.append(action);
      if (finding.paths?.length) {
        const examples = makeElement('p', 'audit-finding__paths', `Example paths: ${finding.paths.join(', ')}`);
        article.append(examples);
      }
      container.append(article);
    }
  }

  function renderSearchIntelligence(pages) {
    const summary = document.querySelector('#audit-intelligence-summary');
    const count = document.querySelector('#audit-intelligence-count');
    const topicMap = document.querySelector('#audit-topic-map');
    const questionMap = document.querySelector('#audit-question-map');
    const evidencePages = pages.filter((page) => page.searchEvidence && typeof page.searchEvidence === 'object');
    const questions = evidencePages.flatMap((page) => (page.searchEvidence.questions || []).map((question) => ({ ...question, pageUrl: question.pageUrl || page.url })));
    const topicLabels = new Set(evidencePages.map((page) => page.searchEvidence.primaryTopic?.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
    const displayLimit = 12;
    const confidenceBand = (value) => !Number.isFinite(value) || value <= 0 ? 'not available' : value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low';

    summary.textContent = evidencePages.length
      ? `${evidencePages.length} scanned pages returned bounded title and heading evidence; ${topicLabels.size} distinct inferred topic labels and ${questions.length} question-style headings were found.`
      : 'No usable title or heading evidence was returned from the checked pages.';
    const languageNote = evidencePages.map((page) => page.searchEvidence.note).find((note) => typeof note === 'string' && /English query patterns|Language is undeclared/i.test(note));
    if (languageNote) summary.textContent += ` ${languageNote}`;
    count.textContent = `${evidencePages.length} pages · ${questions.length} questions`;
    topicMap.replaceChildren();
    questionMap.replaceChildren();

    if (!evidencePages.length) {
      topicMap.append(makeElement('p', 'audit-empty-state', 'No crawl-derived topic map is available for this scan.'));
    } else {
      for (const page of evidencePages.slice(0, displayLimit)) {
        const evidence = page.searchEvidence;
        const item = makeElement('article', 'audit-intelligence-item');
        item.append(makeElement('h5', '', evidence.primaryTopic || page.title || 'Topic not identified'));
        const role = evidence.pageRole?.role || 'other';
        const roleConfidence = confidenceBand(evidence.pageRole?.confidence);
        const topicConfidence = confidenceBand(evidence.topicConfidence);
        item.append(makeElement('p', '', `${pathLabel(page.url)} · inferred page role: ${role.replace(/-/g, ' ')} · role signal: ${roleConfidence} · topic signal: ${topicConfidence}`));
        const roleSignals = Array.isArray(evidence.pageRole?.signals) ? evidence.pageRole.signals.slice(0, 2) : [];
        if (roleSignals.length) item.append(makeElement('p', 'audit-intelligence-item__evidence', `Role evidence: ${roleSignals.join(' · ')}`));
        const sourceHeadings = (evidence.headingEvidence || []).slice(0, 2).map((heading) => `H${heading.level}: ${heading.text}`);
        if (sourceHeadings.length) item.append(makeElement('p', 'audit-intelligence-item__evidence', `Topic evidence: ${sourceHeadings.join(' · ')}`));
        item.append(makeElement('p', 'audit-intelligence-item__evidence', 'Next review: confirm that this topic and inferred page role match the page’s intended purpose.'));
        topicMap.append(item);
      }
      if (evidencePages.length > displayLimit) {
        topicMap.append(makeElement('p', 'audit-intelligence-item__evidence', `Showing ${displayLimit} of ${evidencePages.length} pages. The crawl evidence is available only for this scan.`));
      }
    }

    if (!questions.length) {
      questionMap.append(makeElement('p', 'audit-empty-state', 'No English question-style heading patterns were detected. This does not mean the site has no search demand or useful questions.'));
    } else {
      for (const question of questions.slice(0, displayLimit)) {
        const item = makeElement('article', 'audit-intelligence-item');
        item.append(makeElement('h5', '', question.text));
        const query = question.query || {};
        const intent = query.intent?.primary ? query.intent.primary.replace(/-/g, ' ') : 'not assigned';
        const primaryIntent = query.intent?.labels?.find((signal) => signal.label === query.intent.primary);
        const intentSignal = primaryIntent ? ` · intent signal: ${confidenceBand(primaryIntent.confidence)}` : '';
        const microIntent = Array.isArray(query.microIntent) && query.microIntent.length ? ` · pattern: ${query.microIntent.join(', ')}` : '';
        item.append(makeElement('p', '', `${pathLabel(question.pageUrl)} · inferred intent: ${intent}${intentSignal}${microIntent}`));
        item.append(makeElement('p', 'audit-intelligence-item__evidence', 'Next review: check that the page answers this heading’s question; this scan detected the heading only.'));
        questionMap.append(item);
      }
      if (questions.length > displayLimit) {
        questionMap.append(makeElement('p', 'audit-intelligence-item__evidence', `Showing ${displayLimit} of ${questions.length} question-style headings.`));
      }
    }
  }

  function renderReport(data, pages, partialError = '') {
    const report = createFindings({ ...data, pages });
    const scoreValue = document.querySelector('#audit-score-value');
    const scoreHeading = document.querySelector('#audit-score-heading');
    const scoreSummary = document.querySelector('#audit-score-summary');
    const coverage = document.querySelector('#audit-coverage');
    const scanNote = document.querySelector('#audit-scan-note');
    const status = pages.length < data.pageUrls.length ? `Partial scan: ${pages.length} page${pages.length === 1 ? '' : 's'} were checked before the service stopped.` : '';
    scoreValue.textContent = `${report.score}`;
    scoreHeading.textContent = report.score >= 90 ? 'Strong technical basics' : report.score >= 75 ? 'A good base, with some fixes' : report.score >= 55 ? 'Several useful fixes to make' : 'Start with the priority issues';
    scoreSummary.textContent = `${report.earned} of ${report.possible} weighted checks passed across ${pages.length} scanned page${pages.length === 1 ? '' : 's'}.`;
    const coverageNotes = [];
    if (data.pageLimitReached) coverageNotes.push(`the free scan is capped at ${data.limits.maximumPages} URLs`);
    if (data.sitemapEntryLimitHit) coverageNotes.push(`sitemap discovery stopped after ${data.limits.maximumSitemapEntries} URL entries, so coverage may be incomplete`);
    if (data.sitemapFileLimitHit) coverageNotes.push(`sitemap discovery stopped after ${data.limits.maximumSitemaps} sitemap files, so coverage may be incomplete`);
    if (data.discoveryBudgetHit) coverageNotes.push('sitemap discovery reached its time limit, so coverage may be incomplete');
    coverage.textContent = `Scanned ${pages.length} of ${data.discoveredCount} public page URL${data.discoveredCount === 1 ? '' : 's'} queued for this run${coverageNotes.length ? `; ${coverageNotes.join('; ')}` : ''}.`;
    const notices = [];
    if (data.queryRemoved) notices.push('Query parameters and fragments were removed from the submitted URL for privacy.');
    if (data.robotsDisallowedCount) notices.push(`${data.robotsDisallowedCount} sitemap URL${data.robotsDisallowedCount === 1 ? ' was' : 's were'} skipped because robots.txt disallows them.`);
    const htmlPages = pages.filter((page) => /text\/html|application\/xhtml\+xml/i.test(page.contentType || ''));
    if (htmlPages.length) {
      const blocks = htmlPages.reduce((total, page) => total + (page.jsonLdBlockCount || 0), 0);
      const invalidBlocks = htmlPages.reduce((total, page) => total + (page.invalidJsonLdCount || 0), 0);
      const pagesWithJsonLd = htmlPages.filter((page) => (page.jsonLdBlockCount || 0) > 0).length;
      notices.push(blocks
        ? `JSON-LD syntax: ${blocks} block${blocks === 1 ? '' : 's'} on ${pagesWithJsonLd} of ${htmlPages.length} checked HTML pages; ${invalidBlocks} failed basic JSON parsing. This is not a Schema.org or eligibility review.`
        : `No JSON-LD blocks found on ${htmlPages.length} checked HTML pages; JSON-LD is optional and its absence is not scored as an issue.`);
    } else {
      notices.push('JSON-LD could not be checked because no HTML pages were available.');
    }
    if (partialError || status) notices.push(partialError || status);
    if (!data.sitemapFound) notices.push(data.note);
    else if (!data.truncated) notices.push(data.note);
    scanNote.textContent = notices.join(' ');
    renderPageSpeed(data.pageSpeed, data.submittedUrl);
    renderFindings(report.findings);
    renderSearchIntelligence(pages);
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    results.hidden = true;
    progress.hidden = false;
    progress.value = 0;
    submitButton.disabled = true;
    setStatus('Finding the sitemap and requesting a mobile PageSpeed report…');
    try {
      const prepared = await postScan({ action: 'prepare', url: urlInput.value.trim() });
      const allPages = [];
      let partialError = '';
      const pageUrls = Array.isArray(prepared.pageUrls) ? prepared.pageUrls : [];
      const batchSize = prepared.limits?.pagesPerBatch || 10;
      for (let offset = 0; offset < pageUrls.length; offset += batchSize) {
        const batch = pageUrls.slice(offset, offset + batchSize);
        setStatus(`Checking public page ${Math.min(offset + 1, pageUrls.length)}–${Math.min(offset + batch.length, pageUrls.length)} of ${pageUrls.length}…`);
        try {
          const response = await postScan({
            action: 'scan-pages',
            scanId: prepared.scanId,
            siteUrl: prepared.siteUrl,
            pages: batch,
            finalBatch: offset + batch.length >= pageUrls.length,
          });
          allPages.push(...(response.pages || []));
          progress.value = Math.round((allPages.length / Math.max(pageUrls.length, 1)) * 100);
        } catch (error) {
          partialError = error instanceof Error ? error.message : 'The scan stopped before all pages were checked.';
          break;
        }
      }
      if (!allPages.length && partialError) throw new Error(partialError);
      setStatus(partialError ? 'Partial scan complete. Some pages could not be checked.' : 'Scan complete. Review the highest-impact issues first.');
      renderReport(prepared, allPages, partialError);
    } catch (error) {
      if (error instanceof Error && error.message.includes('request limit')) {
        setStatus(error.message, true);
      } else {
        setStatus(error instanceof Error ? error.message : 'The scan could not be completed. Please try again.', true);
      }
    } finally {
      submitButton.disabled = false;
      progress.hidden = true;
    }
  });

  document.querySelector('#site-audit-reset').addEventListener('click', () => {
    results.hidden = true;
    setStatus('');
    urlInput.focus();
  });
