from pathlib import Path

root = Path.cwd()
zip_helper = (root / '.local-test/create-source-zip-v2-20261004.ps1').read_text(encoding='utf-8-sig')
zip_helper = zip_helper.replace('source-delivery-v2-20261004', 'source-delivery-ui-followup-20261004')
zip_helper = zip_helper.replace('release/API-Manager-2.0.0.zip', 'release/API-Manager-2.0.0-ui-update.zip')
zip_helper = zip_helper.replace("('release/' + $taskBinary)", "('release/ui-followup-build/' + $taskBinary)")
(root / '.local-test/create-source-zip-ui-followup-20261004.ps1').write_text(zip_helper, encoding='utf-8')

portable = (root / '.local-test/portable-v2-cdp.cjs').read_text(encoding='utf-8-sig')
portable = portable.replace('portable-v2-cdp-result.json', 'portable-ui-followup-result.json')
portable = portable.replace('release/API Manager 2.0.0.exe', 'release/ui-followup-build/API Manager 2.0.0.exe')
portable = portable.replace('Upgrade and complete revamp', 'Major upgrade')
portable = portable.replace("await page.getByRole('radio', { name: 'Red', exact: true }).locator('..').click();", "await page.getByRole('combobox', { name: 'Application theme', exact: true }).selectOption('grey');\n    await page.getByRole('radio', { name: 'Red', exact: true }).locator('..').click();")
portable = portable.replace("const find = page.locator('.response-body .find-widget');", "const find = page.locator('.response-body .find-widget');")
portable = portable.replace("await expect(help.getByRole('tabpanel', { name: 'Version history', exact: true })).toContainText('Initial release');", "await expect(help.getByRole('button', { name: 'v2.0.0 Major upgrade', exact: true })).toHaveAttribute('aria-expanded', 'true');\n    await expect(help.getByRole('button', { name: 'v1.0.0 Initial release', exact: true })).toHaveAttribute('aria-expanded', 'false');\n    await help.getByRole('button', { name: 'View release notes', exact: true }).click();\n    await expect(help).toContainText('SOAP');")
portable = portable.replace("const workspace = JSON.parse(await fs.readFile(path.join(profile,'workspace.json'),'utf8'));", "const workspace = JSON.parse(await fs.readFile(path.join(profile,'workspace.json'),'utf8'));\n    if (workspace.settings.theme !== 'grey') throw new Error('Grey theme was not persisted.');")
portable = portable.replace('accentSetting:true,resizableConsole:true', 'accentSetting:true,greyTheme:true,inlineReleaseNotes:true,resizableConsole:true')
(root / '.local-test/portable-ui-followup.cjs').write_text(portable, encoding='utf-8')
