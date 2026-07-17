/**
 * bc_ue_task_send_case_report.js
 *
 * User Event script deployed on the TASK record.
 *
 * On afterSubmit, when:
 *   1. Task status = Complete/Submitted
 *   2. custevent_nx_customer_signature is populated
 *   3. custevent_bc_fsm_cust_email is populated   <-- COMMENTED OUT FOR TESTING
 *
 * ...it gathers EVERY data source the bc_casereport_mcvac.xml template
 * (file cabinet id 33686) actually needs - not just the one task - then
 * renders the full Case Service Report as a PDF and emails it.
 *
 * The template expects these top-level variables:
 *   case              - the Support Case record
 *   tasks             - ALL tasks linked to that case (array)
 *   times             - labor/time-tracking entries for those tasks (array)
 *   salesorder        - sales order lines for those tasks (array)
 *   asset             - the asset record tied to the case
 *   install / repair / maintenance / uninstall - checklist arrays
 *   image             - array of {url, description} objects
 *   companyInformation, subsidiary, logosizes - for the header logo
 *   body.api, body.imgdpimed, body.imgdpisml   - image helper values
 *
 * ============================================================================
 * IMPORTANT - THINGS YOU MUST VERIFY/FIX BEFORE THIS WILL WORK CORRECTLY
 * Search "TODO" - these are account-specific unknowns I can't see from here:
 * exact field IDs linking Task -> Case, the custom record types used for
 * checklists, where "images" actually live, the asset record type, etc.
 * ============================================================================
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
    'N/record',
    'N/render',
    'N/email',
    'N/file',
    'N/search',
    'N/config',
    'N/url',
    'N/log'
], (record, render, email, file, search, config, url, log) => {

    // =========================================================================
    // CONFIG - verify every value in this block against your account
    // =========================================================================

    const TEMPLATE_FILE_ID = 33686; // bc_casereport_mcvac.xml in file cabinet

    const SENDER_ID = 9710; // employee internal ID used as email "from"

    const STATUS_FIELD_ID = 'status';
    const COMPLETE_STATUS = 'COMPLETE'; // TODO confirm actual internal value

    const CUSTOMER_SIGNATURE_FIELD = 'custevent_nx_customer_signature';
    const CUSTOMER_EMAIL_FIELD = 'custevent_bc_fsm_cust_email'; // unused while testing
    const TEST_EMAIL = 'dhruv.soni@bluecollar.cloud';

    // TODO: confirm the field on TASK that links it to its Support Case.
    // Common candidates: 'company' (if the case is filed under company),
    // or a custom field like 'custevent_bc_related_case'. Update both the
    // field id here AND the search filter usage below.
    const TASK_CASE_LINK_FIELD_ID = 'custevent_nx_customer';

    // TODO: confirm which field on the Support Case holds the Asset this
    // report is for.
    const CASE_ASSET_FIELD_ID = 'custevent_nx_case_asset';

    // TODO: confirm the custom record type IDs + linking field for each
    // checklist type. These are guesses based on the field names used in
    // the template (custrecord_nx_install_*, etc.) - the record type id
    // and the field that links a checklist record back to the case are NOT
    // something I can see from here.
    const CHECKLIST_TYPES = {
        install: { recordType: 'customrecord_nx_install_checklist', linkField: 'custrecord_nx_install_case' },
        repair: { recordType: 'customrecord_nx_repair_checklist', linkField: 'custrecord_nx_repair_case' },
        maintenance: { recordType: 'customrecord_nx_maintenance_checklist', linkField: 'custrecord_nx_maintenance_case' },
        uninstall: { recordType: 'customrecord_nx_uninstall_checklist', linkField: 'custrecord_nx_uninstall_case' }
    };

    // TODO: confirm where "images" actually live for a case - this assumes
    // there's a custom record (or sublist) called custrecord_nx_case_image
    // with a file field + description field, linked back to the case.
    const IMAGE_RECORD_TYPE = 'customrecord_nx_case_image';
    const IMAGE_LINK_FIELD_ID = 'custrecord_nx_case_image_case';
    const IMAGE_FILE_FIELD_ID = 'custrecord_nx_case_image_file';
    const IMAGE_DESC_FIELD_ID = 'custrecord_nx_case_image_desc';

    // Target logo size in points - matches the template's `logosizes.target`.
    const LOGO_TARGET_TYPE = 'height';
    const LOGO_TARGET_VALUE = 40;

    // =========================================================================
    // Helpers
    // =========================================================================

    const getValue = (rec, fieldId) => {
        try {
            const v = rec.getValue({ fieldId });
            return (v === null || v === undefined) ? '' : v;
        } catch (e) {
            return '';
        }
    };

    const getText = (rec, fieldId) => {
        try {
            const v = rec.getText({ fieldId });
            return (v === null || v === undefined) ? '' : v;
        } catch (e) {
            return '';
        }
    };

    const getTextOrValue = (rec, fieldId) => {
        const t = getText(rec, fieldId);
        return t !== '' ? t : getValue(rec, fieldId);
    };

    /**
     * Runs a search and returns raw result rows as plain objects keyed by
     * column name (both raw value and _text variant for select fields).
     */
    const runSearch = (type, filters, columns) => {
        const results = [];
        const s = search.create({ type, filters, columns });
        const pagedData = s.runPaged({ pageSize: 1000 });

        pagedData.pageRanges.forEach((pageRange) => {
            const page = pagedData.fetch({ index: pageRange.index });
            page.data.forEach((res) => {
                const row = { internalid: res.id };
                columns.forEach((col) => {
                    const key = typeof col === 'string' ? col : col.label || col.name;
                    row[key] = res.getValue(col);
                    row[key + '_text'] = res.getText(col) || row[key];
                });
                results.push(row);
            });
        });

        return results;
    };

    // =========================================================================
    // Data source builders
    // =========================================================================

    /** All tasks linked to the case (the template loops over `tasks`). */
    const getTasksForCase = (caseId) => {
        const rows = runSearch(
            search.Type.TASK,
            [[TASK_CASE_LINK_FIELD_ID, search.Operator.ANYOF, caseId]],
            [
                'internalid',
                'title',
                'assigned',
                'custevent_nx_start_date',
                'custevent_nx_start_time',
                'custevent_nx_task_type',
                'custevent_nx_task_team',
                'message',
                'custevent_nx_actions_taken',
                'custevent_bc_fsm_tech_name',
                'custevent_nx_customer_name',
                'custevent_nx_technician_signature',
                'custevent_nx_customer_signature'
            ]
        );

        return rows.map((r) => ({
            internalid: r.internalid,
            title: r.title,
            assigned: r.assigned_text,
            custevent_nx_start_date: r.custevent_nx_start_date,
            custevent_nx_start_time: r.custevent_nx_start_time,
            custevent_nx_task_type: r.custevent_nx_task_type_text,
            custevent_nx_task_team: r.custevent_nx_task_team,
            message: r.message,
            custevent_nx_actions_taken: r.custevent_nx_actions_taken,
            custevent_bc_fsm_tech_name: r.custevent_bc_fsm_tech_name,
            custevent_nx_customer_name: r.custevent_nx_customer_name,
            custevent_nx_technician_signature: r.custevent_nx_technician_signature,
            custevent_nx_customer_signature: r.custevent_nx_customer_signature
        }));
    };

    /** Labor/time entries for the given task ids, linked via custcol_nx_task. */
    const getTimesForTasks = (taskIds) => {
        if (!taskIds.length) return [];

        const rows = runSearch(
            'timebill', // TODO confirm this is the correct time-tracking search type
            [['custcol_nx_task', search.Operator.ANYOF, taskIds]],
            [
                'internalid',
                'date',
                'employee',
                'item',
                'custcol_nx_time_start',
                'custcol_bc_fsm_arrive_site',
                'custcol_bc_fsm_leave_site',
                'custcol_nx_time_end',
                'custcol_nx_task'
            ]
        );

        return rows.map((r) => ({
            internalid: r.internalid,
            date: r.date,
            employee: r.employee_text,
            item: r.item_text,
            custcol_nx_time_start: r.custcol_nx_time_start,
            custcol_bc_fsm_arrive_site: r.custcol_bc_fsm_arrive_site,
            custcol_bc_fsm_leave_site: r.custcol_bc_fsm_leave_site,
            custcol_nx_time_end: r.custcol_nx_time_end,
            custcol_nx_task: r.custcol_nx_task
        }));
    };

    /** Sales order lines (parts & charges) for the given task ids. */
    const getSalesOrderLinesForTasks = (taskIds) => {
        if (!taskIds.length) return [];

        const rows = runSearch(
            search.Type.SALES_ORDER,
            [['custcol_nx_task', search.Operator.ANYOF, taskIds]],
            [
                'internalid',
                'quantity',
                'item',
                'memo',
                'custcol_nx_task',
                'custbody_bc_arrival_time'
            ]
        );

        return rows.map((r) => ({
            internalid: r.internalid,
            quantity: r.quantity,
            item: r.item_text,
            memo: r.memo,
            custcol_nx_task: r.custcol_nx_task,
            custbody_bc_arrival_time: r.custbody_bc_arrival_time
        }));
    };

    /** The single asset record referenced by the case. */
    const getAssetData = (caseRec) => {
        const assetId = getValue(caseRec, CASE_ASSET_FIELD_ID);
        if (!assetId) return {};

        try {
            const assetRec = record.load({ type: 'customrecord_nx_asset', id: assetId }); // TODO confirm record type
            return {
                internalid: assetId,
                name: getTextOrValue(assetRec, 'name'),
                custrecord_nx_asset_address_text: getValue(assetRec, 'custrecord_nx_asset_address_text')
            };
        } catch (e) {
            log.error('getAssetData failed', e.message);
            return {};
        }
    };

    /** Generic checklist loader for install/repair/maintenance/uninstall. */
    const getChecklist = (caseId, checklistKey) => {
        const cfg = CHECKLIST_TYPES[checklistKey];
        try {
            return runSearch(
                cfg.recordType,
                [[cfg.linkField, search.Operator.ANYOF, caseId]],
                [
                    'internalid',
                    'custrecord_nx_' + checklistKey + '_asset',
                    'custrecord_nx_' + checklistKey + '_outcome',
                    'custrecord_nx_' + checklistKey + '_notes',
                    'custrecord_nx_' + checklistKey + '_image'
                ]
            );
        } catch (e) {
            log.error('getChecklist failed for ' + checklistKey, e.message);
            return [];
        }
    };

    /** Images attached to the case, as {url, description} objects. */
    const getImages = (caseId) => {
        try {
            const rows = runSearch(
                IMAGE_RECORD_TYPE,
                [[IMAGE_LINK_FIELD_ID, search.Operator.ANYOF, caseId]],
                [IMAGE_FILE_FIELD_ID, IMAGE_DESC_FIELD_ID]
            );

            return rows.map((r) => {
                const fileId = r[IMAGE_FILE_FIELD_ID];
                let fileUrl = '';
                try {
                    const f = file.load({ id: fileId });
                    fileUrl = f.url;
                } catch (e) {
                    log.error('Image file load failed', e.message);
                }
                return {
                    url: fileUrl,
                    description: r[IMAGE_DESC_FIELD_ID] || ''
                };
            }).filter((img) => img.url);
        } catch (e) {
            log.error('getImages failed', e.message);
            return [];
        }
    };

    /** Company info + subsidiary logo, for the header. */
    const getCompanyAndSubsidiaryData = (caseRec) => {
        let companyInformation = { companyname: '', logoUrl: '' };
        let subsidiary = null;

        try {
            const companyInfoRec = config.load({ type: config.Type.COMPANY_INFORMATION });
            companyInformation.companyname = getValue(companyInfoRec, 'companyname');

            const logoFileId = getValue(companyInfoRec, 'logo'); // TODO confirm field id
            if (logoFileId) {
                const logoFile = file.load({ id: logoFileId });
                companyInformation.logoUrl = logoFile.url;
            }
        } catch (e) {
            log.error('getCompanyAndSubsidiaryData - company info failed', e.message);
        }

        try {
            const subsidiaryId = getValue(caseRec, 'subsidiary');
            if (subsidiaryId) {
                const subRec = record.load({ type: record.Type.SUBSIDIARY, id: subsidiaryId });
                const subLogoFileId = getValue(subRec, 'logo');
                subsidiary = { id: subsidiaryId, logo: null };
                if (subLogoFileId) {
                    const subLogoFile = file.load({ id: subLogoFileId });
                    subsidiary.logo = { url: subLogoFile.url };
                }
            }
        } catch (e) {
            log.error('getCompanyAndSubsidiaryData - subsidiary failed', e.message);
        }

        return { companyInformation, subsidiary };
    };

    /**
     * The template's getLogoWidth()/getLogoHeight() functions need actual
     * pixel dimensions of the logo image (logosizes.company.width/height).
     * SuiteScript has no built-in way to read an image's pixel dimensions
     * from a File object - replace the placeholder numbers below with your
     * logo's real pixel dimensions, or the header logo will render at the
     * wrong aspect ratio.
     */
    const buildLogoSizes = () => ({
        target: { type: LOGO_TARGET_TYPE, value: LOGO_TARGET_VALUE },
        company: { width: 300, height: 80 } // TODO replace with real logo pixel dimensions
    });

    // =========================================================================
    // Main entry point
    // =========================================================================

    const afterSubmit = (context) => {
        try {
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.XEDIT
            ) {
                return;
            }

            const taskId = context.newRecord.id;
            if (!taskId) {
                log.error('Missing Task ID', 'No id on newRecord');
                return;
            }

            const taskRec = record.load({ type: record.Type.TASK, id: taskId, isDynamic: false });

            // ---- Condition 1: status ----
            const taskStatus = getValue(taskRec, STATUS_FIELD_ID);
            if (taskStatus !== COMPLETE_STATUS) {
                log.debug('Skip', 'Task ' + taskId + ' status is "' + taskStatus + '"');
                return;
            }

            // ---- Condition 2: signature ----
            const customerSignature = getValue(taskRec, CUSTOMER_SIGNATURE_FIELD);
            if (!customerSignature) {
                log.debug('Skip', 'Task ' + taskId + ' has no customer signature');
                return;
            }

            // ---- Condition 3: report email - COMMENTED OUT FOR TESTING ----
            // const reportEmail = getValue(taskRec, CUSTOMER_EMAIL_FIELD);
            // if (!reportEmail) {
            //     log.debug('Skip', 'Task ' + taskId + ' has no report email');
            //     return;
            // }
            const reportEmail = TEST_EMAIL; // TESTING

            // ---- Resolve the Case ----
            const caseId = getValue(taskRec, TASK_CASE_LINK_FIELD_ID);
            if (!caseId) {
                log.error('No case found', 'Task ' + taskId + ' has no value in ' + TASK_CASE_LINK_FIELD_ID);
                return;
            }

            const caseRec = record.load({ type: record.Type.SUPPORT_CASE, id: caseId });

            // ---- Gather ALL data sources the template needs ----
            const caseData = {
                internalid: caseId,
                casenumber: getTextOrValue(caseRec, 'casenumber'),
                company: getTextOrValue(caseRec, 'company'),
                startdate: getTextOrValue(caseRec, 'startdate'),
                custevent_nx_case_type: getTextOrValue(caseRec, 'custevent_nx_case_type'),
                custevent_nx_case_purchaseorder: getValue(caseRec, 'custevent_nx_case_purchaseorder'),
                custevent_nx_case_details: getValue(caseRec, 'custevent_nx_case_details'),
                contact: {
                    entityid: getTextOrValue(caseRec, 'contact')
                },
                custevent_nx_customer: {
                    id: getValue(caseRec, 'company'),
                    companyname: getTextOrValue(caseRec, 'company'),
                    address: getValue(caseRec, 'custevent_nx_customer_address'), // TODO confirm
                    addressee: getValue(caseRec, 'custevent_nx_customer_addressee') // TODO confirm
                }
            };

            const tasks = getTasksForCase(caseId);
            const taskIds = tasks.map((t) => t.internalid);

            const times = getTimesForTasks(taskIds);
            const salesorder = getSalesOrderLinesForTasks(taskIds);
            const asset = getAssetData(caseRec);

            const install = getChecklist(caseId, 'install');
            const repair = getChecklist(caseId, 'repair');
            const maintenance = getChecklist(caseId, 'maintenance');
            const uninstall = getChecklist(caseId, 'uninstall');

            const image = getImages(caseId);

            const { companyInformation, subsidiary } = getCompanyAndSubsidiaryData(caseRec);
            const logosizes = buildLogoSizes();

            const body = {
                api: url.resolveDomain({ hostType: url.HostType.APPLICATION }), // used by fieldValueToFileUrl macro
                imgdpimed: 150,
                imgdpisml: 96
            };

            log.debug('Data gathered', {
                caseId, taskCount: tasks.length, timesCount: times.length,
                salesorderCount: salesorder.length, imageCount: image.length,
                installCount: install.length, repairCount: repair.length,
                maintenanceCount: maintenance.length, uninstallCount: uninstall.length
            });

            // ---- Load template + render ----
            const templateFile = file.load({ id: TEMPLATE_FILE_ID });
            const templateContent = templateFile.getContents();

            const renderer = render.create();
            renderer.templateContent = templateContent;

            const addObj = (alias, data) => renderer.addCustomDataSource({
                format: render.DataSource.OBJECT,
                alias,
                data
            });

            addObj('case', caseData);
            addObj('tasks', tasks);
            addObj('times', times);
            addObj('salesorder', salesorder);
            addObj('asset', asset);
            addObj('install', install);
            addObj('repair', repair);
            addObj('maintenance', maintenance);
            addObj('uninstall', uninstall);
            addObj('image', image);
            addObj('companyInformation', companyInformation);
            addObj('subsidiary', subsidiary || {});
            addObj('logosizes', logosizes);
            addObj('body', body);

            const renderedXml = renderer.renderAsString();
            if (!renderedXml) {
                log.error('Rendered XML empty', 'Template produced no output');
                return;
            }

            const pdfFile = render.xmlToPdf({ xmlString: renderedXml });
            pdfFile.name = 'Case_Service_Report_' + caseData.casenumber + '.pdf';

            // ---- Send email ----
            email.send({
                author: SENDER_ID,
                recipients: reportEmail,
                subject: 'Case Service Report - Case #' + caseData.casenumber,
                body: 'Hi,\n\nPlease find attached the service report for Case #' +
                      caseData.casenumber + ', generated automatically after the ' +
                      'customer signature was captured.\n\nThank you.',
                attachments: [pdfFile],
                relatedRecords: { entityId: caseId }
            });

            log.audit('Report sent', 'Case ' + caseId + ' report emailed to ' + reportEmail);

        } catch (e) {
            log.error('afterSubmit error', (e.message || e) + (e.stack ? ' | ' + e.stack : ''));
        }
    };

    return { afterSubmit };
});