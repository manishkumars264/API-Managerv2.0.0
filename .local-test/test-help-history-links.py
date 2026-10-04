from pathlib import Path
p=Path('tests/e2e/workspace.spec.ts')
s=p.read_text(encoding='utf-8')
old="    await expect(dialog.getByRole('tabpanel', { name: 'Version history', exact: true })).toContainText('1.0.0');"
new=old+'''
    const history = dialog.getByRole('tabpanel', { name: 'Version history', exact: true });
    await history.locator('article').filter({ has: page.getByRole('heading', { name: 'v1.0.0', exact: true }) }).getByRole('button', { name: 'View full release notes', exact: true }).click();
    await expect(notes).toContainText('v1.0.0'); await expect(notes).toContainText('Initial release');
    await expect(notes).toContainText('Basic, Bearer Token, and API Key'); await expect(notes).not.toContainText('History, Console, and cookies');
    await dialog.getByRole('tab', { name: 'Version history', exact: true }).click();
    await history.locator('article').filter({ has: page.getByRole('heading', { name: 'v2.0.0', exact: true }) }).getByRole('button', { name: 'View full release notes', exact: true }).click();
    await expect(notes).toContainText('v2.0.0'); await expect(notes).toContainText('Upgrade and complete revamp');
    await expect(notes).toContainText('History, Console, and cookies'); await expect(notes).not.toContainText('Initial release');
    await dialog.getByRole('tab', { name: 'Version history', exact: true }).click();'''
assert old in s
p.write_text(s.replace(old,new,1),encoding='utf-8')
