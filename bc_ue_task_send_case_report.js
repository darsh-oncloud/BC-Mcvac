/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
    'N/record',
    'N/render',
    'N/email',
    'N/file',
    'N/log'
], (
    record,
    render,
    email,
    file,
    log
) => {

    // XML file internal ID
    const TEMPLATE_FILE_ID = 33686;

    // Employee internal ID used as the sender
    const SENDER_ID = 9710;

    // Support Case field on the Task
    const CASE_LINK_FIELD_ID = 'supportcase';

    // Task status configuration
    const STATUS_FIELD_ID = 'status';
    const STATUS_SUBMITTED_VALUE = 'COMPLETE';

    // Task customer-signature field
    const SIGNATURE_FIELD_ID = 'custevent_nx_customer_signature';

    // Testing recipient
    const TEST_EMAIL = 'dhruv.soni@bluecollar.cloud';

    /**
     * Safely gets a record field value for logging.
     */
    const safeGetValue = (rec, fieldId) => {
        try {
            return rec.getValue({
                fieldId: fieldId
            });
        } catch (e) {
            return '';
        }
    };

    const afterSubmit = (context) => {
        try {
            const allowedEvents = [
                context.UserEventType.CREATE,
                context.UserEventType.EDIT,
                context.UserEventType.XEDIT
            ];

            if (allowedEvents.indexOf(context.type) === -1) {
                return;
            }

            const taskId = context.newRecord.id;

            if (!taskId) {
                log.error({
                    title: 'Missing Task ID',
                    details: 'Task internal ID was not available.'
                });
                return;
            }

            /*
             * Load the complete Task record.
             *
             * This is important for XEDIT because context.newRecord may contain
             * only the fields changed during inline editing.
             */
            const taskRec = record.load({
                type: record.Type.TASK,
                id: taskId,
                isDynamic: false
            });

            // ---------------------------------------------------------------
            // Condition 1: Task must be complete
            // ---------------------------------------------------------------

            const status = taskRec.getValue({
                fieldId: STATUS_FIELD_ID
            });

            log.debug({
                title: 'Task Status',
                details: {
                    taskId: taskId,
                    status: status,
                    requiredStatus: STATUS_SUBMITTED_VALUE
                }
            });

            if (status !== STATUS_SUBMITTED_VALUE) {
                log.debug({
                    title: 'Skip - Task Not Complete',
                    details:
                        'Task ' + taskId +
                        ' status is "' + status +
                        '", not "' + STATUS_SUBMITTED_VALUE + '".'
                });
                return;
            }

            // ---------------------------------------------------------------
            // Condition 2: Customer signature must be populated
            // ---------------------------------------------------------------

            const signature = taskRec.getValue({
                fieldId: SIGNATURE_FIELD_ID
            });

            if (!signature) {
                log.debug({
                    title: 'Skip - No Signature',
                    details:
                        'Task ' + taskId +
                        ' has no customer signature.'
                });
                return;
            }

            // ---------------------------------------------------------------
            // Get Support Case from Task
            // ---------------------------------------------------------------

            const caseIdValue = taskRec.getValue({
                fieldId: CASE_LINK_FIELD_ID
            });

            const caseId = Number(caseIdValue);

            if (!caseIdValue || !caseId || isNaN(caseId)) {
                log.error({
                    title: 'No Valid Support Case',
                    details: {
                        taskId: taskId,
                        fieldId: CASE_LINK_FIELD_ID,
                        fieldValue: caseIdValue
                    }
                });
                return;
            }

            log.debug({
                title: 'Support Case Found',
                details: {
                    taskId: taskId,
                    caseId: caseId
                }
            });

            // ---------------------------------------------------------------
            // Load Support Case
            // ---------------------------------------------------------------

            const caseRec = record.load({
                type: record.Type.SUPPORT_CASE,
                id: caseId,
                isDynamic: false
            });

            const caseNumber =
                safeGetValue(caseRec, 'casenumber') || caseId;

            log.debug({
                title: 'Support Case Data',
                details: {
                    caseId: caseId,
                    caseNumber: caseNumber,
                    title: safeGetValue(caseRec, 'title'),
                    company: safeGetValue(caseRec, 'company'),
                    status: safeGetValue(caseRec, 'status')
                }
            });

            // ---------------------------------------------------------------
            // Load XML template
            // ---------------------------------------------------------------

            const templateFile = file.load({
                id: TEMPLATE_FILE_ID
            });

            const templateContent = templateFile.getContents();

            if (!templateContent) {
                log.error({
                    title: 'Empty XML Template',
                    details:
                        'Template file ' + TEMPLATE_FILE_ID +
                        ' does not contain XML content.'
                });
                return;
            }

            /*
             * Log the template variables.
             *
             * Examples:
             * ${record.casenumber}
             * ${record.title}
             * ${task.custevent_nx_customer_signature}
             */
            const templateVariables =
                templateContent.match(/\$\{[^}]+\}/g) || [];

            log.debug({
                title: 'XML Template Information',
                details: {
                    templateId: TEMPLATE_FILE_ID,
                    templateName: templateFile.name,
                    usesRecordAlias:
                        templateContent.indexOf('${record.') !== -1,
                    usesTaskAlias:
                        templateContent.indexOf('${task.') !== -1,
                    variables: templateVariables.slice(0, 100)
                }
            });

            // ---------------------------------------------------------------
            // Render XML as PDF
            // ---------------------------------------------------------------

            const renderer = render.create();

            renderer.templateContent = templateContent;

            /*
             * Support Case fields must be referenced in the XML as:
             *
             * ${record.casenumber}
             * ${record.title}
             * ${record.company}
             */
            renderer.addRecord({
                templateName: 'record',
                record: caseRec
            });

            /*
             * Task fields must be referenced in the XML as:
             *
             * ${task.title}
             * ${task.custevent_nx_customer_signature}
             */
            renderer.addRecord({
                templateName: 'task',
                record: taskRec
            });

            const pdfFile = renderer.renderAsPdf();

            pdfFile.name =
                'CaseReport_' + caseNumber + '.pdf';

            log.audit({
                title: 'PDF Generated',
                details: {
                    taskId: taskId,
                    caseId: caseId,
                    caseNumber: caseNumber,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

            // ---------------------------------------------------------------
            // Send email to testing recipient
            // ---------------------------------------------------------------

            email.send({
                author: SENDER_ID,

                // Testing email only
                recipients: TEST_EMAIL,

                subject:
                    'Case Service Report - Case #' + caseNumber,

                body:
                    'Hi,\n\n' +
                    'Please find attached the service report for Case #' +
                    caseNumber + '.\n\n' +
                    'The report was generated automatically after the ' +
                    'customer signature was captured.\n\n' +
                    'Thank you.',

                attachments: [
                    pdfFile
                ]

                /*
                 * No relatedRecords property.
                 *
                 * Therefore, the script is not explicitly attaching the
                 * email to the Support Case Communication tab.
                 */
            });

            log.audit({
                title: 'Report Sent',
                details: {
                    taskId: taskId,
                    caseId: caseId,
                    caseNumber: caseNumber,
                    recipient: TEST_EMAIL,
                    senderEmployeeId: SENDER_ID,
                    pdfName: pdfFile.name
                }
            });

        } catch (e) {
            log.error({
                title: 'afterSubmit Error',
                details: {
                    name: e.name || '',
                    message: e.message || String(e),
                    stack: e.stack || ''
                }
            });
        }
    };

    return {
        afterSubmit: afterSubmit
    };
});