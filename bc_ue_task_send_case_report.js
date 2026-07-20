/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Fires on the Task record. When a task is marked Complete and has a
 * customer signature, loads the related Support Case, gathers the case's
 * tasks / labor / parts data, renders the Case Service Report PDF using
 * the same XML template as the "Report" button, and emails it out.
 */
define(['N/record', 'N/render', 'N/email', 'N/file', 'N/search', 'N/log'],
    (record, render, email, file, search, log) => {

        // ---- Template file (File Cabinet internal ID of the .xml template) ----
        const TEMPLATE_FILE_ID = 33686;

        // ---- Email sending ----
        const SENDER_ID = 9710; // TODO: confirm this is a valid employee internal ID with email send permission

        // TESTING ONLY: hardcoded recipient. Swap for the real field once validated in prod.
        const TEST_EMAIL = 'dhruv.soni@bluecollar.cloud';

        // ---- Field IDs on the TASK record ----
        const STATUS_FIELD_ID = 'status';
        const STATUS_SUBMITTED_VALUE = 'COMPLETE';     // TODO: confirm the exact status value/id used on this record
        const SIGNATURE_FIELD_ID = 'custevent_nx_customer_signature';
        const CASE_LINK_FIELD_ID = 'supportcase'; // TODO: confirm — must match the field the vendor searches as "case.internalid"

        // ---- Field IDs used to pull related records for the report ----
        const SO_CASE_LINK_FIELD_ID = 'custbody_nx_case';   // Sales Order body field linking a line to the case
        const SO_TASK_LINK_FIELD_ID = 'custcol_nx_task';    // Sales Order column field linking a line to a task
        const TIME_TASK_LINK_FIELD_ID = 'custcol_nx_task';  // Time Bill column field linking an entry to a task

        // -------------------------------------------------------------------------

        const afterSubmit = (context) => {
            try {
                if (context.type !== context.UserEventType.EDIT &&
                    context.type !== context.UserEventType.CREATE &&
                    context.type !== context.UserEventType.XEDIT) {
                    return;
                }

                const newRec = context.newRecord;

                // ---- Condition 1: Task status is Complete ----
                const status = newRec.getValue({ fieldId: STATUS_FIELD_ID });
                if (status !== STATUS_SUBMITTED_VALUE) {
                    log.debug('Skip', 'Task ' + newRec.id + ' status is "' + status + '", not complete');
                    return;
                }

                // ---- Condition 2: Customer signature must be populated ----
                const signature = newRec.getValue({ fieldId: SIGNATURE_FIELD_ID });
                if (!signature) {
                    log.debug('Skip', 'Task ' + newRec.id + ' has no customer signature yet');
                    return;
                }

                // TESTING: hardcoded recipient. Re-add the real email-field check once confirmed
                // (e.g. skip if getValue({fieldId:'custevent_bc_fsm_cust_email'}) is empty).
                const reportEmail = TEST_EMAIL;

                // ---- Get the related Support Case ----
                const caseId = newRec.getValue({ fieldId: CASE_LINK_FIELD_ID });
                if (!caseId) {
                    log.error('No case found', 'Task ' + newRec.id + ' has no related case in field ' + CASE_LINK_FIELD_ID);
                    return;
                }

                // ---- Load the case record (drives "case.*" in the template) ----
                const caseRec = record.load({
                    type: record.Type.SUPPORT_CASE,
                    id: caseId,
                    isDynamic: false
                });

                // ---- Gather related data the template needs ----
                const tasks = getCaseTasks(caseId);
                const taskIds = tasks.map((t) => t.getValue({ name: 'internalid' }));
                const salesorder = getCaseSalesOrderLines(caseId);
                const times = getTaskTimeBills(taskIds);

                // TODO: confirm the asset link field on the case, then load it here.
                // Left empty so the "Site Details" section prints blank instead of erroring.
                const asset = {};

                // TODO: confirm the checklist record types (install/repair/maintenance/uninstall)
                // and their case-link field, then run equivalent searches here.
                const install = [];
                const repair = [];
                const maintenance = [];
                const uninstall = [];

                // TODO: confirm how images are attached to the case (file field, sublist, or
                // related custom record) and build [{url, description}, ...] here.
                const images = [];

                // ---- Load the XML template ----
                const templateFile = file.load({ id: TEMPLATE_FILE_ID });

                // ---- Render the PDF ----
                const renderer = render.create();
                renderer.templateContent = templateFile.getContents();

                renderer.addRecord({ templateName: 'case', record: caseRec });
                renderer.addSearchResults({ templateName: 'tasks', searchResults: tasks });
                renderer.addSearchResults({ templateName: 'salesorder', searchResults: salesorder });
                renderer.addSearchResults({ templateName: 'times', searchResults: times });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'asset', data: asset });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'install', data: install });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'repair', data: repair });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'maintenance', data: maintenance });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'uninstall', data: uninstall });
                renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'image', data: images });

                const pdfFile = renderer.renderAsPdf();
                pdfFile.name = 'CaseReport_' + caseId + '.pdf';

                // ---- Send the email with the PDF attached ----
                email.send({
                    author: SENDER_ID,
                    recipients: reportEmail,
                    subject: 'Case Service Report - Case #' + caseId,
                    body: 'Hi,\n\nPlease find attached the service report for this case, ' +
                          'generated automatically after the customer signature was captured.\n\n' +
                          'Thank you.',
                    attachments: [pdfFile],
                    relatedRecords: {
                        entityId: caseId
                    }
                });

                log.audit('Report sent', 'Case ' + caseId + ' report emailed to ' + reportEmail +
                    ' from Task ' + newRec.id);

            } catch (e) {
                log.error('afterSubmit error', (e.message || e) + (e.stack ? ' | ' + e.stack : ''));
            }
        };

        // -------------------------------------------------------------------------
        // Data helpers
        // -------------------------------------------------------------------------

        // Standard Task records linked to this case
        function getCaseTasks(caseId) {
            const results = [];
            const taskSearch = search.create({
                type: search.Type.TASK,
                filters: [[CASE_LINK_FIELD_ID, 'anyof', caseId]],
                columns: [
                    'internalid',
                    'custevent_nx_start_date',
                    'custevent_nx_start_time',
                    'assigned',
                    'custevent_nx_task_type',
                    'custevent_nx_task_team',
                    'message',
                    'custevent_nx_actions_taken',
                    'custevent_bc_fsm_tech_name',
                    'custevent_nx_customer_name',
                    'custevent_nx_technician_signature',
                    'custevent_nx_customer_signature'
                ]
            });
            taskSearch.run().each((r) => { results.push(r); return true; });
            return results;
        }

        // Sales Order lines linked to this case (mainline = F, i.e. item lines only)
        function getCaseSalesOrderLines(caseId) {
            const results = [];
            const soSearch = search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['mainline', 'is', 'F'],
                    'AND',
                    [SO_CASE_LINK_FIELD_ID, 'anyof', caseId]
                ],
                columns: [
                    'quantity',
                    'item',
                    'memo',
                    SO_TASK_LINK_FIELD_ID
                ]
            });
            soSearch.run().each((r) => { results.push(r); return true; });
            return results;
        }

        // Time Bill entries for the given set of task internal IDs
        function getTaskTimeBills(taskIds) {
            if (!taskIds || taskIds.length === 0) return [];
            const results = [];
            const timeSearch = search.create({
                type: search.Type.TIME_BILL,
                filters: [[TIME_TASK_LINK_FIELD_ID, 'anyof', taskIds]],
                columns: [
                    'date',
                    'employee',
                    'item',
                    'custcol_nx_time_start',
                    'custcol_bc_fsm_arrive_site',
                    'custcol_bc_fsm_leave_site',
                    'custcol_nx_time_end',
                    TIME_TASK_LINK_FIELD_ID
                ]
            });
            timeSearch.run().each((r) => { results.push(r); return true; });
            return results;
        }

        return { afterSubmit };
    });