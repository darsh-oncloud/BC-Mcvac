/**

 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/render', 'N/email', 'N/file', 'N/log'],
    (record, render, email, file, log) => {

        const TEMPLATE_FILE_ID = 33686;

        const SENDER_ID = 9710; // TODO: replace with a real internal ID

        const CASE_LINK_FIELD_ID = 'supportcase'; // TODO: confirm

        const STATUS_FIELD_ID = 'status';               // TODO: confirm
        const STATUS_SUBMITTED_VALUE = 'COMPLETE';       // TODO: confirm

        // TESTING: hardcoded recipient while custevent_bc_fsm_cust_email check is off
        const TEST_EMAIL = 'dhruv.soni@bluecollar.cloud';

        // -------------------------------------------------------------------------

        const afterSubmit = (context) => {
            try {
                if (context.type !== context.UserEventType.EDIT &&
                    context.type !== context.UserEventType.CREATE &&
                    context.type !== context.UserEventType.XEDIT) {
                    return;
                }

                const newRec = context.newRecord;

                // ---- Condition 1: Task status is Submitted/Completed ----
                const status = newRec.getValue({ fieldId: STATUS_FIELD_ID });
                if (status !== STATUS_SUBMITTED_VALUE) {
                    log.debug('Skip', 'Task ' + newRec.id + ' status is "' + status + '", not submitted/completed');
                    return;
                }

                // ---- Condition 2: Customer signature must be populated ----
                const signature = newRec.getValue({ fieldId: 'custevent_nx_customer_signature' });
                if (!signature) {
                    log.debug('Skip', 'Task ' + newRec.id + ' has no customer signature yet');
                    return;
                }

                // TESTING: hardcoded recipient (remove once condition 3 is restored above)
                const reportEmail = TEST_EMAIL;

                // ---- Get the related Support Case (mcvac work order) ----
                const caseId = newRec.getValue({ fieldId: CASE_LINK_FIELD_ID });
                if (!caseId) {
                    log.error('No case found', 'Task ' + newRec.id + ' has no related case in field ' + CASE_LINK_FIELD_ID);
                    return;
                }

                // ---- Load the case record (used as the data source for the template) ----
                const caseRec = record.load({
                    type: record.Type.SUPPORT_CASE,
                    id: caseId
                });

                // ---- Load the XML template from the file cabinet ----
                const templateFile = file.load({ id: TEMPLATE_FILE_ID });
                const templateContent = templateFile.getContents();

                // ---- Render the template + case data into a PDF ----
                const renderer = render.create();
                renderer.templateContent = templateContent;
                renderer.addRecord({
                    templateName: 'record',
                    record: caseRec
                });

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
                        activityId: Number(caseId)
                    }
                });

                log.audit('Report sent', 'Case ' + caseId + ' report emailed to ' + reportEmail +
                    ' from Task ' + newRec.id);

            } catch (e) {
                log.error('afterSubmit error', (e.message || e) + (e.stack ? ' | ' + e.stack : ''));
            }
        };

        return { afterSubmit };
    });
