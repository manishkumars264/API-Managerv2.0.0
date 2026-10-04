from pathlib import Path
p=Path('tests/e2e/workspace.spec.ts')
s=p.read_text(encoding='utf-8')
start=s.index("    await dialog.getByRole('tab', { name: 'Release notes', exact: true }).click();",s.index("test('opens About and Help"))
end=s.index("    await dialog.getByRole('tab', { name: 'About', exact: true }).click();",start)
s=s[:start]+'''    await expect(dialog.getByRole('tab', { name: 'Release notes', exact: true })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Version history', exact: true }).click();
    const history = dialog.getByRole('tabpanel', { name: 'Version history', exact: true });
    const v2 = history.getByRole('button', { name: 'v2.0.0 Major upgrade', exact: true });
    const v1 = history.getByRole('button', { name: 'v1.0.0 Initial release', exact: true });
    await expect(v2).toHaveAttribute('aria-expanded', 'true'); await expect(v1).toHaveAttribute('aria-expanded', 'false');
    const v2Card = history.locator('article').filter({ has: v2 }), v1Card = history.locator('article').filter({ has: v1 });
    await v2Card.getByRole('button', { name: 'View release notes', exact: true }).click();
    for (const feature of ['SOAP', 'Authorization', 'Response tools', 'Import, export', 'History, Console', 'Pre-request']) await expect(v2Card).toContainText(feature);
    await expect(dialog.getByRole('tabpanel', { name: 'Version history', exact: true })).toBeVisible();
    await v1.click(); await expect(v1).toHaveAttribute('aria-expanded', 'true'); await expect(v2).toHaveAttribute('aria-expanded', 'false');
    await v1Card.getByRole('button', { name: 'View release notes', exact: true }).click();
    await expect(v1Card).toContainText('Basic, Bearer Token, and API Key'); await expect(v1Card).not.toContainText('History, Console, and cookies');
    await v2.click(); await expect(v2).toHaveAttribute('aria-expanded', 'true'); await expect(v1).toHaveAttribute('aria-expanded', 'false');
    await v2.click(); await expect(v2).toHaveAttribute('aria-expanded', 'false');
    await v2.click();
    await page.screenshot({ path: path.join(appRoot, '.local-test', 'help-accordion-followup-20261004.png') });
'''+s[end:]
p.write_text(s,encoding='utf-8')
